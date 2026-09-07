"""Frame-based reframing must keep every source frame and important cut boundaries."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('portrait', ROOT/'scripts/render_portrait.py')
portrait = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portrait)
PLAN = json.loads((ROOT/'media/portrait-framing.json').read_text())


class PortraitTests(unittest.TestCase):
    def test_shots_cover_every_frame_and_stay_inside_source(self):
        for branch in ['right','wrong']:
            shots = portrait.validate(PLAN, branch)
            for frame in range(PLAN[branch]['frames']):
                x,width = portrait.crop_at(shots,frame)
                self.assertGreaterEqual(x,0)
                self.assertLessEqual(x+width,1280)
                self.assertGreaterEqual(width,405)

    def test_reframing_cuts_on_observed_source_frames(self):
        cuts = {'right':[104,185,344,1210,1344,1451], 'wrong':[104,185,344,1048,1104,1635,1771]}
        for branch, expected in cuts.items():
            shots = portrait.validate(PLAN,branch)
            for frame in expected:
                shot = next(s for s in shots if s['start']==frame)
                _,centre,width = shot['poses'][0]
                self.assertEqual(portrait.crop_at(shots,frame),(round(centre-width/2),width))

    def test_shared_intro_and_choice_boundary_have_identical_framing(self):
        right=portrait.validate(PLAN,'right'); wrong=portrait.validate(PLAN,'wrong')
        for frame in range(721):
            self.assertEqual(portrait.crop_at(right,frame),portrait.crop_at(wrong,frame))
        self.assertEqual(portrait.crop_at(right,719),portrait.crop_at(right,720))

    def test_phone_reading_preserves_both_sides_of_picture(self):
        shots=portrait.validate(PLAN,'wrong')
        for frame in range(1152,1311):
            self.assertEqual(portrait.crop_at(shots,frame),(0,1280))
        # The phone on the counter is part of the kitchen scene too.
        for frame in range(1771,1945):
            x,width=portrait.crop_at(shots,frame)
            self.assertLessEqual(x,140)
            self.assertGreaterEqual(x+width,1200)


if __name__ == '__main__':
    unittest.main()
