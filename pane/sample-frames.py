#!/usr/bin/env python3
"""pane/sample-frames.py: draws the sample game's pictures (pane/sample/shots/0001.png ... 0006.png).

The sample game has no real game to take pictures from, so its pictures are calm stand-ins in ROM Studio's own look
(the system of its video): the graphite backdrop, a framed panel, a cyan label pill, the scene in IBM Plex Mono, one
plain line saying what it is. 480 x 320, the shape of a game picture at twice its size.
Needs Pillow. Run again after changing the look: python3 pane/sample-frames.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"
W, H = 480, 320
BG, CARD, RULE, INK, INK2, ACCENT, ON_ACCENT, PINK = "#0f1116", "#17181c", "#414b59", "#e4e8ea", "#b6babd", "#58dae8", "#161616", "#ff7eb6"
mono = lambda size, weight="SemiBold": ImageFont.truetype(str(FONTS / f"IBMPlexMono-{weight}.ttf"), size)
sans = lambda size: ImageFont.truetype(str(FONTS / "Inter_18pt-Regular.ttf"), size)


def picture(scene, step, of):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((16, 16, W - 17, H - 17), 12, fill=CARD, outline=RULE, width=1)  # the framed panel
    x, y = 40, 92
    pill = "SAMPLE PICTURE"
    f = mono(13)
    tw = d.textlength(pill, font=f)
    d.rounded_rectangle((x, y, x + tw + 18, y + 26), 5, fill=ACCENT)
    d.text((x + 9, y + 4), pill, font=f, fill=ON_ACCENT)
    d.text((x, y + 46), scene, font=mono(28), fill=INK)
    d.text((x, y + 92), f"Step {step} of {of}. A stand-in: the sample", font=sans(17), fill=INK2)
    d.text((x, y + 116), "game has no game to take pictures from.", font=sans(17), fill=INK2)
    return im


scenes = ["1 Your room", "1 Your room", "1 Your room", "2 Someone to talk to", "2 Someone to talk to", "3 The town outside"]
for i, scene in enumerate(scenes, 1):
    out = HERE / "sample" / "shots" / f"{i:04d}.png"
    picture(scene, i, len(scenes)).save(out, optimize=True)
    print(out)
