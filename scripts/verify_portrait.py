#!/usr/bin/env python3
"""Verify recorded media hashes, encoded cut frames and unchanged AAC packets.

Requires FFmpeg/ffprobe and Pillow, like render_portrait.py. Run after rendering.
"""
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageChops, ImageStat
import render_portrait as portrait

ROOT = Path(__file__).resolve().parent.parent


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def decode_frames(path, frames):
    selection = 'select=' + '+'.join(f'eq(n\\,{frame})' for frame in frames)
    return subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:v:0',
        '-vf', selection, '-fps_mode', 'vfr', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ])


def audio_hash(path):
    return subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0',
        '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-',
    ])


def verify():
    plan_path = ROOT / 'media/portrait-framing.json'
    plan = json.loads(plan_path.read_text())
    manifest = json.loads((ROOT / 'media/portrait-manifest.json').read_text())
    assert manifest['plan_sha256'] == sha256(plan_path), 'Framing changed since rendering'
    reports = []
    for branch, record in zip(['right', 'wrong'], manifest['videos']):
        cfg = plan[branch]
        source, output = ROOT / cfg['source'], ROOT / cfg['output']
        assert record['source_sha256'] == sha256(source), 'Source changed since rendering'
        assert record['output_sha256'] == sha256(output), 'Output changed since rendering'
        info = portrait.probe(output)
        assert int(info['nb_frames']) == cfg['frames'] and info['avg_frame_rate'] == '24/1'
        shots = portrait.validate(plan, branch)
        frames = sorted({0, 719, 720, cfg['frames'] - 1, *[
            n for shot in shots for n in [shot['start'] - 1, shot['start'], shot['end'] - 1] if n >= 0
        ]})
        src, out = decode_frames(source, frames), decode_frames(output, frames)
        source_bytes, output_bytes = 1280 * 720 * 3, 576 * 1024 * 3
        assert len(src) == len(frames) * source_bytes and len(out) == len(frames) * output_bytes
        errors = []
        for i, frame in enumerate(frames):
            original = Image.frombytes('RGB', (1280, 720), src[i*source_bytes:(i+1)*source_bytes])
            expected = portrait.compose(original, portrait.crop_at(shots, frame), (576, 1024))
            actual = Image.frombytes('RGB', (576, 1024), out[i*output_bytes:(i+1)*output_bytes])
            error = sum(ImageStat.Stat(ImageChops.difference(expected, actual)).mean) / 3
            assert error < 6, (branch, frame, error)
            errors.append(error)
        assert audio_hash(source) == audio_hash(output), 'Audio packets differ'
        report = {
            'branch': branch, 'checked_frames': frames,
            'max_mean_rgb_error': round(max(errors), 3), 'audio_packets_identical': True,
        }
        reports.append(report)
        print(report, flush=True)
    (ROOT / 'media/portrait-verification.json').write_text(json.dumps(reports, indent=2) + '\n')


if __name__ == '__main__':
    verify()
