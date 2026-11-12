#!/usr/bin/env python3
"""Large battle pictures for people: make them engine-ready, check them, register them.

A person in the game has a small walking picture and, if they can be fought (or are the
player), a large battle picture. This tool handles the large ones.

  front picture   64x64, the whole figure facing the viewer, feet near the bottom row
  back picture    64 wide, FRAMES x 64 tall: a vertical strip of the player seen from behind
                  (frame 0 ready, 1 arm back, 2 throw, 3 standing; the engine shows 3 first)
  both            one 16-colour palette, colour 0 is the see-through colour, hard edges

Commands (run from the game folder, or pass --game):

  python3 tools/portraits.py front  drawing.png keeper            any size in, 64x64 out
  python3 tools/portraits.py back   strip.png keeper              4 frames, down or across
  python3 tools/portraits.py pair   front.png strip.png keeper    both, sharing one palette
  python3 tools/portraits.py lint   graphics/trainers/front_pics/keeper.png ...
  python3 tools/portraits.py register keeper [--back] [--apply]   prints (or writes) the lines
  python3 tools/portraits.py sheet  out.png a.png b.png [--scale 4]   side-by-side on dark

Options for front/back/pair: --outline (add a 1-pixel dark edge), --keep-canvas (do not crop
and fit; the source is already laid out), --frames N.

Files written: graphics/trainers/front_pics/<name>.png, back_pics/<name>.png and
palettes/<name>.pal (the palette the game loads; the PNG carries the same one).

The second half of the file is a small drawing kit (class Fig) for building a figure from
layered shapes in code: see its docstring.
"""
import argparse
import os
import re
import sys

from PIL import Image, ImageDraw

SIZE = 64            # width and height of one picture (one frame)
BACK_FRAMES = 4      # frames in a back-picture strip
COLOURS = 16         # palette entries, entry 0 is see-through
CLEAR = (115, 197, 164)  # the colour stored in entry 0 (never shown)
DARK = (16, 18, 24)      # outline colour used by --outline

# The game folder: where you run it from if that is a game folder, else the folder above this file.
GAME = os.getcwd() if os.path.isdir(os.path.join(os.getcwd(), "graphics/trainers")) else \
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Problem(Exception):
    pass


def snap(c):
    """The handheld shows 5 bits per channel: round each channel down to a multiple of 8."""
    return tuple(v & 0xF8 for v in c[:3])


# ------------------------------------------------------------------ reading a source picture

def load_rgba(path):
    """Any picture -> RGBA. With no see-through part, the corner colour is taken as background."""
    im = Image.open(path)
    if im.mode == "P" and "transparency" not in im.info:
        # an engine-style indexed picture: entry 0 is the background
        idx = list(im.getdata())
        rgba = im.convert("RGBA")
        rgba.putdata([(r, g, b, 0 if i == 0 else 255) for (r, g, b, _), i in zip(rgba.getdata(), idx)])
        return rgba
    im = im.convert("RGBA")
    if min(a for *_, a in im.getdata()) == 255:
        px = im.load()
        w, h = im.size
        bg = px[0, 0][:3]
        seen, todo = set(), [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
        while todo:
            x, y = todo.pop()
            if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
                continue
            if sum(abs(a - b) for a, b in zip(px[x, y][:3], bg)) > 36:
                continue
            seen.add((x, y))
            todo += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        for y in range(h):               # enclosed gaps (between an arm and the body) in that exact colour
            for x in range(w):
                if sum(abs(a - b) for a, b in zip(px[x, y][:3], bg)) <= 8:
                    seen.add((x, y))
        for x, y in seen:
            px[x, y] = (0, 0, 0, 0)
    return im


def resize_hard(im, size):
    """Scale RGBA to size with hard edges: colours are averaged, see-through is yes or no."""
    if im.size == size:
        out = im.copy()
    else:
        w, h = im.size
        kx, ky = w / size[0], h / size[1]
        if kx == ky and kx == int(kx) and kx > 1 and _is_blocky(im, int(kx)):
            out = im.resize(size, Image.NEAREST)          # pixel art shown enlarged: take it back
        else:
            pre = Image.new("RGBA", im.size)
            pre.putdata([(r * a // 255, g * a // 255, b * a // 255, a) for r, g, b, a in im.getdata()])
            pre = pre.resize(size, Image.BOX if kx >= 1 else Image.NEAREST)
            out = Image.new("RGBA", size)
            out.putdata([(min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a), a) if a else (0, 0, 0, 0)
                         for r, g, b, a in pre.getdata()])
    out.putdata([(r, g, b, 255) if a >= 128 else (0, 0, 0, 0) for r, g, b, a in out.getdata()])
    return out


def _is_blocky(im, k):
    px = im.load()
    for y in range(0, im.size[1] - k + 1, k):
        for x in range(0, im.size[0] - k + 1, k):
            c = px[x, y]
            if any(px[x + i, y + j] != c for i in (0, k - 1, k // 2) for j in (0, k - 1, k // 2)):
                return False
    return True


def fit_front(im, keep_canvas=False):
    """Crop to the figure, scale it down if needed, stand it on the second-last row, centred."""
    if keep_canvas:
        return resize_hard(im, (SIZE, SIZE))
    box = im.getbbox()
    if not box:
        raise Problem("the source picture is empty")
    im = im.crop(box)
    w, h = im.size
    for k in range(16, 1, -1):          # pixel art shown enlarged k times: take it back exactly
        if w % k == 0 and h % k == 0 and _is_blocky(im, k):
            im = im.resize((w // k, h // k), Image.NEAREST)
            w, h = im.size
            break
    room = SIZE - 2                     # one empty row and column all round
    if w > room or h > room:
        k = max(w / room, h / room)
        im = resize_hard(im, (max(1, int(w / k)), max(1, int(h / k))))
    else:
        im = resize_hard(im, im.size)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(im, ((SIZE - im.size[0]) // 2, SIZE - 1 - im.size[1]))
    return out


def split_strip(im, frames):
    """A strip of frames, down or across, -> list of 64x64 RGBA frames (each whole cell scaled)."""
    w, h = im.size
    cells = []
    if h >= w:
        ch = h // frames
        cells = [im.crop((0, i * ch, w, (i + 1) * ch)) for i in range(frames)]
    else:
        cw = w // frames
        cells = [im.crop((i * cw, 0, (i + 1) * cw, h)) for i in range(frames)]
    cw, ch = cells[0].size
    if cw != ch:
        raise Problem(f"each of the {frames} frames must be square; this strip gives {cw}x{ch} frames")
    return [resize_hard(c, (SIZE, SIZE)) for c in cells]


def add_outline(im):
    px = im.load()
    w, h = im.size
    edge = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] and any(
        0 <= x + dx < w and 0 <= y + dy < h and not px[x + dx, y + dy][3]
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for x, y in edge:
        px[x, y] = DARK + (255,)
    return im


# ------------------------------------------------------------------ 16 colours

def build_palette(frames):
    """One palette for all the frames: at most 15 colours plus the see-through entry."""
    cols = {}
    for im in frames:
        for r, g, b, a in im.getdata():
            if a:
                c = snap((r, g, b))
                cols[c] = cols.get(c, 0) + 1
    if len(cols) > COLOURS - 1:
        flat = [c for c, n in cols.items() for _ in range(n)]
        strip = Image.new("RGB", (len(flat), 1))
        strip.putdata(flat)
        q = strip.quantize(COLOURS - 1, method=Image.MEDIANCUT, dither=Image.NONE)
        raw = q.getpalette()[:(COLOURS - 1) * 3]
        used = sorted(set(q.getdata()))
        cols = {snap(tuple(raw[i * 3:i * 3 + 3])): 1 for i in used}
    pal = sorted(cols, key=lambda c: -(c[0] * 3 + c[1] * 6 + c[2]))   # light to dark, outline last
    clear = CLEAR
    while snap(clear) in pal:
        clear = (clear[0], clear[1] - 8, clear[2])
    pal = [clear] + pal
    return pal + [(0, 0, 0)] * (COLOURS - len(pal))


def to_indexed(frames, pal):
    """RGBA frames -> one indexed picture, frames stacked downwards."""
    n = COLOURS - 1
    out = Image.new("P", (SIZE, SIZE * len(frames)), 0)
    flat = []
    for c in pal:
        flat += list(c)
    out.putpalette(flat)
    cache = {}
    px = out.load()
    for f, im in enumerate(frames):
        src = im.load()
        for y in range(SIZE):
            for x in range(SIZE):
                r, g, b, a = src[x, y]
                if not a:
                    continue
                c = snap((r, g, b))
                if c not in cache:
                    cache[c] = min(range(1, n + 1), key=lambda i: sum((p - q) ** 2 for p, q in zip(pal[i], c)))
                px[x, f * SIZE + y] = cache[c]
    return out


def save_indexed(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, bits=4)


def save_pal(pal, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as f:
        f.write("JASC-PAL\r\n0100\r\n16\r\n" + "".join("%d %d %d\r\n" % tuple(c) for c in pal))


def read_pal(path):
    lines = open(path).read().split()
    if lines[0] != "JASC-PAL":
        raise Problem(f"{path} is not a palette file of the kind the engine reads (JASC-PAL)")
    nums = [int(v) for v in lines[3:]]
    return [tuple(nums[i:i + 3]) for i in range(0, len(nums), 3)]


def paths(name, game=None):
    base = os.path.join(game or GAME, "graphics/trainers")
    return (os.path.join(base, "front_pics", name + ".png"),
            os.path.join(base, "back_pics", name + ".png"),
            os.path.join(base, "palettes", name + ".pal"))


def convert(name, front=None, back=None, frames=BACK_FRAMES, outline=False, keep_canvas=False, game=None):
    """front / back: paths or RGBA images. Writes the engine files and lints them."""
    get = lambda s: s if isinstance(s, Image.Image) else load_rgba(s)
    f_frames = [fit_front(get(front), keep_canvas)] if front is not None else []
    b_frames = split_strip(get(back), frames) if back is not None else []
    if outline:
        f_frames = [add_outline(f) for f in f_frames]
        b_frames = [add_outline(f) for f in b_frames]
    pal = build_palette(f_frames + b_frames)
    fp, bp, pp = paths(name, game)
    written = []
    if f_frames:
        save_indexed(to_indexed(f_frames, pal), fp)
        written.append(fp)
    if b_frames:
        save_indexed(to_indexed(b_frames, pal), bp)
        written.append(bp)
    save_pal(pal, pp)
    for w in written:
        print("wrote", os.path.relpath(w, game or GAME))
    print("wrote", os.path.relpath(pp, game or GAME))
    bad = sum(lint(w, kind="back" if w == bp else "front", frames=frames) for w in written)
    return bad == 0


# ------------------------------------------------------------------ lint

def lint(path, kind=None, frames=BACK_FRAMES, quiet=False):
    """Print what is wrong with one picture; return the number of problems."""
    probs, warns, note = [], [], ""
    name = os.path.relpath(path)
    try:
        im = Image.open(path)
    except Exception as e:
        print(f"FAIL {name}: cannot be opened as a picture ({e})")
        return 1
    if kind is None:
        kind = "back" if ("back_pics" in path or im.size[1] > im.size[0]) else "front"
    want = (SIZE, SIZE) if kind == "front" else (SIZE, SIZE * frames)
    if im.size != want:
        probs.append(f"size is {im.size[0]}x{im.size[1]}, must be {want[0]}x{want[1]}"
                     + (f" ({frames} frames of {SIZE}x{SIZE} stacked downwards)" if kind == "back" else ""))
    if im.mode != "P":
        rgba = im.convert("RGBA")
        soft = sum(1 for *_, a in rgba.getdata() if 0 < a < 255)
        cols = len({snap(p) for p in rgba.getdata() if p[3] == 255})
        probs.append(f"not an indexed (palette) picture: it is {im.mode} with {cols} solid colours"
                     + (f" and {soft} semi-transparent pixels (soft edge)" if soft else "")
                     + "; run the front/back command on it")
    else:
        used = sorted(set(im.getdata()))
        ncol = len(im.getpalette() or []) // 3
        if used and used[-1] >= COLOURS:
            probs.append(f"uses palette entry {used[-1]}; only entries 0 to 15 exist in the game "
                         f"({len(used)} colours used)")
        elif ncol > COLOURS:
            warns.append(f"the palette holds {ncol} entries; only the first 16 are used")
        tr = im.info.get("transparency")
        if isinstance(tr, bytes) and any(0 < a < 255 for a in tr):
            probs.append("the palette has semi-transparent entries; colours must be solid, entry 0 is the only see-through one")
        if im.size == want:
            px = im.load()
            for f in range(want[1] // SIZE):
                tag = f"frame {f}: " if kind == "back" else ""
                solid = {(x, y) for y in range(SIZE) for x in range(SIZE) if px[x, f * SIZE + y] != 0}
                if not solid:
                    probs.append(tag + "empty")
                    continue
                xs = [x for x, _ in solid]
                ys = [y for _, y in solid]
                if min(ys) == 0:
                    probs.append(tag + "touches the top edge (the head will look cut off)")
                if kind == "front":
                    if min(xs) == 0 or max(xs) == SIZE - 1:
                        probs.append(tag + "touches the left or right edge (leave 1 empty column)")
                    if max(ys) < SIZE - 4:
                        warns.append(tag + f"feet end on row {max(ys)}; the figure will float (stand it on row 62)")
                elif max(ys) < SIZE - 1:
                    probs.append(tag + f"ends on row {max(ys)}: a back picture must run off the bottom edge (row 63), "
                                 "or the figure floats above the message box")
                lone = _specks(solid, 1)
                if lone:
                    probs.append(tag + f"{len(lone)} stray single pixel(s) not joined to the figure, e.g. at {lone[0]}"
                                 " (left over from a soft edge?)")
                elif _specks(solid, 3):
                    warns.append(tag + f"tiny loose bits not joined to the figure, e.g. at {_specks(solid, 3)[0]} (meant?)")
                fringe = _fringe(px, f * SIZE, solid, im.getpalette())
                if fringe > 12:
                    warns.append(tag + f"{fringe} edge pixels are close to the background colour (a soft-edge fringe?)")
        pp = os.path.join(os.path.dirname(os.path.dirname(path)), "palettes", os.path.basename(path)[:-4] + ".pal")
        if os.path.exists(pp):
            pal = read_pal(pp)
            mine = im.getpalette()[:COLOURS * 3]
            mine = [tuple(mine[i:i + 3]) for i in range(0, len(mine), 3)]
            if len(pal) != COLOURS:
                probs.append(f"{os.path.relpath(pp)} has {len(pal)} colours, must be 16")
            elif [snap(c) for c in pal[1:len(mine)]] != [snap(c) for c in mine[1:]]:
                probs.append(f"its colours differ from {os.path.relpath(pp)}, which is the palette the game loads")
        else:
            note = "; no palette file beside it, so the game must read the palette from the PNG"
    if not quiet:
        for p in probs:
            print(f"FAIL {name}: {p}")
        for w in warns:
            print(f"warn {name}: {w}")
        if not probs:
            print(f"ok   {name} ({kind}{note})")
    return len(probs)


def _specks(solid, upto=3):
    """Groups of at most `upto` pixels that are not joined (8 ways) to anything else."""
    left, out = set(solid), []
    while left:
        start = left.pop()
        group, todo = [start], [start]
        while todo:
            x, y = todo.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in left:
                        left.remove(q)
                        group.append(q)
                        todo.append(q)
        if len(group) <= upto:
            out.append(start)
    return out


def _fringe(px, y0, solid, pal):
    bg = pal[0:3]
    n = 0
    for x, y in solid:
        if any((x + dx, y + dy) not in solid for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            c = pal[px[x, y0 + y] * 3: px[x, y0 + y] * 3 + 3]
            if sum(abs(a - b) for a, b in zip(c, bg)) < 60:
                n += 1
    return n


# ------------------------------------------------------------------ registering

def c_names(name):
    camel = "".join(p.capitalize() for p in name.split("_"))
    return camel, "TRAINER_PIC_" + name.upper(), " ".join(p.capitalize() for p in name.split("_"))


def register(name, back=False, apply=False, y_offset=4, anim="sBackAnims_Hoenn", game=None):
    """The three source places a NEW picture id needs (a replaced picture needs none)."""
    game = game or GAME
    camel, const, party = c_names(name)
    gfx = os.path.join(game, "src/data/graphics/trainers.h")
    ids = os.path.join(game, "include/constants/trainers.h")
    pic_lines = [
        f'const u32 gTrainerFrontPic_{camel}[] = INCGFX_U32("graphics/trainers/front_pics/{name}.png", ".4bpp.smol");',
        f'const u16 gTrainerPalette_{camel}[] = INCGFX_U16("graphics/trainers/palettes/{name}.pal", ".gbapal");',
    ]
    if back:
        pic_lines.append(f'const u8 gTrainerBackPic_{camel}[] = INCGFX_U8("graphics/trainers/back_pics/{name}.png", ".4bpp");')
    entry = [f"    [{const}] =", "    {",
             f"        .frontPic = TRAINER_FRONT_PIC(gTrainerFrontPic_{camel}, gTrainerPalette_{camel}),"]
    if back:
        entry.append(f"        .backPic = TRAINER_BACK_PIC({y_offset}, gTrainerBackPic_{camel}, gTrainerPalette_{camel}, {anim}),")
    entry.append("    },")
    text = f"""To register "{name}" as a new battle picture (three places, two files):

1. include/constants/trainers.h, in `enum TrainerPicID`, directly ABOVE the line
   `TRAINER_PIC_COUNT,` (append only: never insert higher up, the numbers are saved in data):

    {const},

2. src/data/graphics/trainers.h, on their own lines directly ABOVE the line
   `static const union AnimCmd sAnimCmd_Hoenn[] =`:

{chr(10).join(pic_lines)}

3. src/data/graphics/trainers.h, in the table `gTrainerPicInfo`, directly above its closing `}};`
   (the last line of the file):

{chr(10).join(entry)}

Then a person you can battle uses it with the line `Pic: {party}` in src/data/trainers.party.
The last three numbers a front picture may take, TRAINER_FRONT_PIC(pic, pal, x, y, rotation),
only move it in the close-up some battles open with; leave them out.
{"A back picture's first number (" + str(y_offset) + ") is its vertical offset; " + anim + " is the 4-frame throw." if back else ""}"""
    if not apply:
        print(text)
        return True
    src_ids, src_gfx = open(ids).read(), open(gfx).read()
    if re.search(r"\b%s\b" % const, src_ids) or f"gTrainerFrontPic_{camel}[" in src_gfx:
        print(f"{const} is already registered; nothing changed")
        return True
    a1 = "    TRAINER_PIC_COUNT,\n"
    a2 = "static const union AnimCmd sAnimCmd_Hoenn[] =\n"
    tail = src_gfx.rstrip("\n")
    if src_ids.count(a1) != 1 or src_gfx.count(a2) != 1 or not tail.endswith("};") or "gTrainerPicInfo[TRAINER_PIC_COUNT]" not in src_gfx:
        print("The source does not look as expected, so nothing was changed. Add the lines by hand:\n")
        print(text)
        return False
    new_ids = src_ids.replace(a1, f"    {const},\n" + a1)
    new_gfx = tail[:-2].replace(a2, "\n".join(pic_lines) + "\n\n" + a2) + "\n".join(entry) + "\n};\n"
    for path, body in ((ids, new_ids), (gfx, new_gfx)):
        tmp = path + ".portraits.tmp"
        with open(tmp, "w") as f:
            f.write(body)
        os.replace(tmp, path)   # each file changes in one step
    print(f"registered {const} (include/constants/trainers.h, src/data/graphics/trainers.h); use `Pic: {party}`")
    return True


# ------------------------------------------------------------------ looking at pictures

def sheet(out, files, scale=4, bg=(24, 24, 32), frames=BACK_FRAMES):
    """Pictures side by side, enlarged, on a dark ground. A back strip is laid out across."""
    cells = []
    for f in files:
        rgba = load_rgba(f)
        n = rgba.size[1] // SIZE if rgba.size[0] == SIZE and rgba.size[1] > SIZE else 1
        for i in range(n):
            cells.append(rgba.crop((0, i * SIZE, rgba.size[0], (i + 1) * SIZE)) if n > 1 else rgba)
    w = sum(c.size[0] for c in cells) + 4 * (len(cells) + 1)
    h = max(c.size[1] for c in cells) + 8
    im = Image.new("RGB", (w, h), bg)
    x = 4
    for c in cells:
        im.paste(c, (x, h - 4 - c.size[1]), c)
        x += c.size[0] + 4
    im = im.resize((w * scale, h * scale), Image.NEAREST)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    im.save(out)
    print("wrote", out)


# ================================================================== drawing kit

class Fig:
    """A figure built from layered shapes, in palette letters, with hard edges.

    pal maps one letter to (palette entry, (r, g, b)); "." is entry 0, the see-through colour;
    "K" is the outline. Work in this order: far limbs, body masses, clothing, near limbs, head,
    face, hair, then extra shadows and folds, then finish().

      f = Fig(PAL)
      f.shape("abc", ("L", 20, 30, 24, 44, 5, 4))      a tapered limb in tones a (light) b c (dark)
      f.shape("abc", ("P", [(x, y), ...]), ("E", cx, cy, rx, ry))   one mass from several pieces
      f.tone("c", ("P", [...]), on="ab")               a fold or cast shadow, only over a and b
      f.line("K", [(x, y), ...])                       a 1-pixel line
      f.stamp(x, y, ["..aa..", ".abba."])              hand-placed pixels (face, fingers)
      im = f.finish()                                  outline the silhouette, return RGBA

    Each shape gets a 1-pixel dark edge (ol="K"; ol=None joins it to what is under it) and is
    shaded from the upper left: hl pixels of light tone on that side, sh pixels of dark tone on
    the lower right. Coordinates are pixels and may be fractions.
    """
    SS = 4

    def __init__(self, pal, w=SIZE, h=SIZE):
        self.pal, self.w, self.h = pal, w, h
        self.px = [["."] * w for _ in range(h)]

    # -- masks
    def mask(self, prims):
        s = self.SS
        im = Image.new("L", (self.w * s, self.h * s), 0)
        d = ImageDraw.Draw(im)
        for p in prims:
            self._prim(d, p, s)
        small = im.resize((self.w, self.h), Image.BOX)
        px = small.load()
        return {(x, y) for y in range(self.h) for x in range(self.w) if px[x, y] >= 128}

    def _prim(self, d, p, s):
        k = p[0]
        if k == "P":
            d.polygon([(x * s, y * s) for x, y in p[1]], fill=255)
        elif k == "E":
            _, cx, cy, rx, ry = p
            d.ellipse([(cx - rx) * s, (cy - ry) * s, (cx + rx) * s, (cy + ry) * s], fill=255)
        elif k == "R":
            _, x0, y0, x1, y1 = p
            d.rectangle([x0 * s, y0 * s, x1 * s, y1 * s], fill=255)
        elif k == "L":
            _, x0, y0, x1, y1, w0, w1 = p
            self._limb(d, x0, y0, x1, y1, w0, w1, s)
        elif k == "C":                     # chain: [(x, y, width), ...]
            pts = p[1]
            for (x0, y0, w0), (x1, y1, w1) in zip(pts, pts[1:]):
                self._limb(d, x0, y0, x1, y1, w0, w1, s)
        else:
            raise ValueError(k)

    @staticmethod
    def _limb(d, x0, y0, x1, y1, w0, w1, s):
        dx, dy = x1 - x0, y1 - y0
        n = (dx * dx + dy * dy) ** 0.5 or 1
        nx, ny = -dy / n, dx / n
        r0, r1 = w0 / 2, w1 / 2
        d.polygon([((x0 + nx * r0) * s, (y0 + ny * r0) * s), ((x1 + nx * r1) * s, (y1 + ny * r1) * s),
                   ((x1 - nx * r1) * s, (y1 - ny * r1) * s), ((x0 - nx * r0) * s, (y0 - ny * r0) * s)], fill=255)
        d.ellipse([(x0 - r0) * s, (y0 - r0) * s, (x0 + r0) * s, (y0 + r0) * s], fill=255)
        d.ellipse([(x1 - r1) * s, (y1 - r1) * s, (x1 + r1) * s, (y1 + r1) * s], fill=255)

    # -- painting
    def shape(self, tones, *prims, ol="K", hl=1, sh=1, clip=None):
        m = self.mask(prims)
        if clip is not None:
            m &= self.mask(clip)
        light, mid, dark = (tones * 3)[:3] if len(tones) == 1 else (tones[0], tones[0], tones[1]) if len(tones) == 2 else tones
        inner = {(x, y) for x, y in m if all(q in m for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))} if ol else m
        for x, y in m:
            if (x, y) not in inner:
                self.px[y][x] = ol
                continue
            lit = any((x - k, y - k) not in inner for k in range(1, hl + 1)) or \
                any((x - k, y) not in inner or (x, y - k) not in inner for k in range(1, (hl + 1) // 2 + 1)) if hl else False
            shd = any((x + k, y + k) not in inner for k in range(1, sh + 1)) or \
                any((x + k, y) not in inner or (x, y + k) not in inner for k in range(1, (sh + 1) // 2 + 1)) if sh else False
            self.px[y][x] = mid if lit == shd else light if lit else dark
        return m

    def tone(self, letter, *prims, on=None):
        for x, y in self.mask(prims):
            if self.px[y][x] != "." and (on is None or self.px[y][x] in on):
                self.px[y][x] = letter

    def line(self, letter, pts, on=None):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0))) or 1
            for i in range(n + 1):
                x, y = int(round(x0 + (x1 - x0) * i / n)), int(round(y0 + (y1 - y0) * i / n))
                if 0 <= x < self.w and 0 <= y < self.h and (on is None or self.px[y][x] in on):
                    self.px[y][x] = letter

    def dot(self, letter, *pts):
        for x, y in pts:
            if 0 <= x < self.w and 0 <= y < self.h:
                self.px[y][x] = letter

    def stamp(self, x, y, rows, flip=False):
        """Rows of letters; " " leaves the pixel alone, "." clears it."""
        for j, row in enumerate(rows):
            row = row[::-1] if flip else row
            for i, ch in enumerate(row):
                if ch != " " and 0 <= x + i < self.w and 0 <= y + j < self.h:
                    self.px[y + j][x + i] = ch

    def erase(self, *prims):
        for x, y in self.mask(prims):
            self.px[y][x] = "."

    def finish(self, outline="K", open_bottom=False):
        """Dark edge all round the silhouette (not along the bottom of a back frame); RGBA out."""
        solid = {(x, y) for y in range(self.h) for x in range(self.w) if self.px[y][x] != "."}
        for x, y in solid:
            for qx, qy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                off = not (0 <= qx < self.w and 0 <= qy < self.h)
                if (not open_bottom) if off else (qx, qy) not in solid:
                    self.px[y][x] = outline
                    break
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                ch = self.px[y][x]
                if ch != ".":
                    px[x, y] = tuple(self.pal[ch][1]) + (255,)
        return im


def strip(frames):
    """RGBA frames -> one vertical strip (the form the back command takes)."""
    out = Image.new("RGBA", (frames[0].size[0], frames[0].size[1] * len(frames)), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.paste(f, (0, i * f.size[1]))
    return out


# ------------------------------------------------------------------ command line

def main(argv=None):
    global GAME
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--game", help="the game folder (default: the current folder if it is one)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("front", "back", "pair"):
        p = sub.add_parser(c)
        if c == "pair":
            p.add_argument("front_src")
            p.add_argument("back_src")
        else:
            p.add_argument("src")
        p.add_argument("name", help="lower case with underscores, e.g. lighthouse_keeper")
        p.add_argument("--outline", action="store_true")
        p.add_argument("--keep-canvas", action="store_true")
        p.add_argument("--frames", type=int, default=BACK_FRAMES)
    p = sub.add_parser("lint")
    p.add_argument("files", nargs="+")
    p.add_argument("--kind", choices=["front", "back"])
    p.add_argument("--frames", type=int, default=BACK_FRAMES)
    p = sub.add_parser("register")
    p.add_argument("name")
    p.add_argument("--back", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--y-offset", type=int, default=4)
    p = sub.add_parser("sheet")
    p.add_argument("out")
    p.add_argument("files", nargs="+")
    p.add_argument("--scale", type=int, default=4)
    a = ap.parse_args(argv)
    if a.game:
        GAME = os.path.abspath(a.game)
    try:
        if a.cmd in ("front", "back", "pair"):
            if not re.fullmatch(r"[a-z][a-z0-9_]*", a.name):
                raise Problem("the name must be lower case letters, digits and underscores")
            ok = convert(a.name,
                         front=a.src if a.cmd == "front" else a.front_src if a.cmd == "pair" else None,
                         back=a.src if a.cmd == "back" else a.back_src if a.cmd == "pair" else None,
                         frames=a.frames, outline=a.outline, keep_canvas=a.keep_canvas)
        elif a.cmd == "lint":
            ok = sum(lint(f, kind=a.kind, frames=a.frames) for f in a.files) == 0
        elif a.cmd == "register":
            ok = register(a.name, back=a.back, apply=a.apply, y_offset=a.y_offset)
        else:
            sheet(a.out, a.files, a.scale)
            ok = True
    except Problem as e:
        print("FAIL:", e)
        ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
