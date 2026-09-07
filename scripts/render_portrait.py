#!/usr/bin/env python3
"""Offline, frame-exact mobile derivatives. Requires FFmpeg and Pillow, never run by make build.

uv run --locked --group media scripts/render_portrait.py [--proof-dir /tmp/portrait-proof]
Edit media/portrait-framing.json, inspect the proof sheets, then commit the MP4s.
Original timing and AAC audio are preserved. Nothing is uploaded by this script.
"""
import argparse
import bisect
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / 'media/portrait-framing.json'


def validate(plan, branch):
    shots = plan['shared'] + plan[branch]['shots']
    cursor = 0
    for shot in shots:
        assert shot['start'] == cursor and shot['end'] > cursor, 'Noncontiguous shots'
        poses = shot['poses']
        assert poses[0][0] == shot['start'] and poses[-1][0] == shot['end'] - 1
        assert all(a[0] < b[0] for a, b in zip(poses, poses[1:])), 'Unordered poses'
        for frame, centre, width in poses:
            assert 405 <= width <= 1280 and width/2 <= centre <= 1280-width/2, (branch, frame, centre, width)
        cursor = shot['end']
    assert cursor == plan[branch]['frames']
    return shots


def crop_at(shots, frame):
    shot = shots[bisect.bisect_right([s['start'] for s in shots], frame) - 1]
    poses = shot['poses']
    for a, b in zip(poses, poses[1:]):
        if frame <= b[0]:
            u = (frame-a[0])/(b[0]-a[0])
            # Smoothstep is deterministic at each source frame; no temporal filtering across cuts.
            u = u*u*(3-2*u)
            centre = a[1] + (b[1]-a[1])*u
            width = a[2] + (b[2]-a[2])*u
            return round(centre-width/2), round(width)
    return round(poses[-1][1]-poses[-1][2]/2), round(poses[-1][2])


def compose(frame, crop, size):
    from PIL import Image, ImageEnhance, ImageFilter
    x, width = crop
    subject = frame.crop((x, 0, x+width, 720))
    # The padded area is deliberately defocused and dim: no fabricated scenery.
    backdrop = subject.resize((72, 128), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(8))
    backdrop = ImageEnhance.Brightness(backdrop).enhance(.55).resize(size, Image.Resampling.BILINEAR)
    height = min(size[1], round(720*size[0]/width))
    foreground = subject.resize((size[0], height), Image.Resampling.LANCZOS)
    backdrop.paste(foreground, (0, (size[1]-height)//2))
    return backdrop


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,avg_frame_rate,duration', '-of', 'json', str(path)]))['streams'][0]


def render(plan, branch, proof):
    from PIL import Image, ImageDraw
    cfg = plan[branch]; shots = validate(plan, branch)
    source = ROOT / cfg['source']; output = ROOT / cfg['output']; size = tuple(plan['output_size'])
    original = probe(source)
    assert int(original['nb_frames']) == cfg['frames'] and original['avg_frame_rate'] == '24/1'
    assert [original['width'], original['height']] == plan['source_size']
    samples = set(range(0, cfg['frames'], 24))
    samples.update(n for s in shots for n in [s['start']-1, s['start'], s['end']-1] if n >= 0)
    samples.update(p[0] for s in shots for p in s['poses'])
    thumbs = []
    with tempfile.TemporaryDirectory(prefix='portrait-render-') as temp:
        target = Path(temp) / 'portrait.mp4'
        with open(Path(temp)/'decode.log', 'w+') as log:
            decode = subprocess.Popen(['ffmpeg','-v','error','-i',str(source),'-map','0:v:0','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=log)
            encode = subprocess.Popen(['ffmpeg','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{size[0]}x{size[1]}','-r','24','-i','-','-i',str(source),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-g','48','-video_track_timescale','24000','-c:a','copy','-movflags','+faststart',str(target)],stdin=subprocess.PIPE,stderr=log)
            try:
                for n in range(cfg['frames']):
                    raw = decode.stdout.read(1280*720*3)
                    if len(raw) != 1280*720*3: raise RuntimeError(f'Decoder ended at frame {n}')
                    frame = Image.frombytes('RGB',(1280,720),raw)
                    result = compose(frame,crop_at(shots,n),size)
                    encode.stdin.write(result.tobytes())
                    if proof and n in samples:
                        thumbs.append((n,result.resize((162,288))))
                    if branch == 'right' and n == 280:
                        result.save(ROOT/'assets/poster-portrait.jpg',quality=90)
                    if n % 480 == 0: print(f'{branch}: {n}/{cfg["frames"]} frames',flush=True)
                assert decode.stdout.read(1) == b'', 'Unexpected extra source frames'
                encode.stdin.close()
                if decode.wait() or encode.wait():
                    log.seek(0); raise RuntimeError(log.read())
            finally:
                if decode.poll() is None: decode.kill(); decode.wait()
                if encode.poll() is None: encode.kill(); encode.wait()
        result = probe(target)
        assert int(result['nb_frames']) == cfg['frames'] and result['avg_frame_rate'] == '24/1'
        assert abs(float(result['duration'])-float(original['duration'])) < .00001
        output.write_bytes(target.read_bytes())
    if proof:
        proof.mkdir(parents=True,exist_ok=True)
        for start in range(0,len(thumbs),24):
            batch=thumbs[start:start+24]; sheet=Image.new('RGB',(6*162,4*312),'#102f35'); draw=ImageDraw.Draw(sheet)
            for i,(n,thumb) in enumerate(batch):
                x=i%6*162;y=i//6*312;sheet.paste(thumb,(x,y+24));draw.text((x+4,y+5),f'{branch} f{n} {n/24:.2f}s',fill='white')
            sheet.save(proof/f'{branch}-{start//24}.jpg',quality=90)
    return {'source':cfg['source'],'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'output':cfg['output'],'output_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'frames':cfg['frames'],'fps':24,'size':list(size),'bytes':output.stat().st_size}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--proof-dir',type=Path); args=parser.parse_args()
    plan=json.loads(PLAN.read_text()); manifest={'plan_sha256':hashlib.sha256(PLAN.read_bytes()).hexdigest(),'videos':[]}
    for branch in ['right','wrong']: manifest['videos'].append(render(plan,branch,args.proof_dir))
    (ROOT/'media/portrait-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Both portrait films have matching source frame counts and durations.')
