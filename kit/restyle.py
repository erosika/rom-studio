#!/usr/bin/env python3
"""Restyle an existing tileset IN PLACE, by role. Nothing about maps or building blocks changes. Run through
`kit tileset <name> restyle --profile <file>`; directly:

  python3 kit/restyle.py --game <game folder> --base <commit with the original art> --profile my-look.json \\
      data/tilesets/secondary/<name> [--primary data/tilesets/primary/<name>] [--palette-only] [--strips a.png:1,b.png:6]

Kept exactly: the sheet's size, every tile's position, the building blocks and what they do, the number of palette
files, animation frame sizes and counts, and WHICH dots of a tile are see-through (so objects made of several tiles
still fit together and layer the same way). Changed: the dots of tiles.png and of the animation frames, and the
colours in palettes/*.pal.

Every run starts from the original art (read from --base in git and kept under out/redraw_orig/), so running twice
gives the same result, and a corrected roles.json or profile simply replaces the last run.
 1. ROLES come from roles.json beside the tileset (`kit tileset <name> roles` writes the first guess; edit "role").
 2. Each 8x8 tile takes the role of the building blocks that use it most, and the palette it is shown with most.
 3. Each tile is redrawn by role using only the palette positions that role already uses, so it stays right under
    every palette it is shown with. Treatments (profile "treatments", role -> name):
      flat     merge near-equal tones, drop lone dots (every other treatment starts with this)
      plate    one flat fill with a seam on the right and bottom edge      (default for ground, path, floor)
      reeds    thin stems on the plate                                     (default for tall_grass)
      slats    horizontal bands, outline kept                              (default for foliage)
      ripples  flat with short dashes                                      (default for water)
      seams    flat with two dark lines                                    (default for roof)
      keep     leave the tile's dots as they are
 4. Every palette colour moves onto the profile's ramps by hue family and brightness; the plate colours of ground,
    path and floor are set to the profile's.

The profile is the user's look, one JSON file (no colours are built in):
  {"name": "harbour", "lore": "harbour-town", "gamma": 1.0,
   "ramps": {"neutral": ["#101418", "#8090a0", "#f0f0e8"], "green": [...], "blue": [...], "warm": [...], "yellow": [...], "red": [...]},
   "plate": {"ground": "#c8d0c0", "path": "#d8d0b8", "floor": "#b0b8c0"},
   "treatments": {"foliage": "flat"}}
Each ramp runs dark to light with two or more colours; a family left out uses "neutral".
"""
import colorsys, json, os, re, struct, subprocess, sys
from collections import Counter, defaultdict
from PIL import Image

GAME = None; BASE = None
RAMPS = {}; PLATE = {}; GAMMA = 1.0
TREAT = {'ground': 'plate', 'path': 'plate', 'floor': 'plate', 'tall_grass': 'reeds', 'foliage': 'slats', 'water': 'ripples', 'roof': 'seams'}
FAMILIES = ('neutral', 'green', 'blue', 'warm', 'yellow', 'red')
NT, NM, NP, NPAL = 512, 512, 6, 13

def die(msg): print(msg, file=sys.stderr); sys.exit(1)
def load_json(path):
    """A JSON file of the game folder; a file that is missing or not valid JSON ends the run with a sentence, not a traceback."""
    try:
        with open(path) as f: return json.load(f)
    except OSError as e: die(f'cannot read {path}: {e.strerror or e}')
    except ValueError as e: die(f'{path} is not valid JSON ({e}). Correct that file, or bring it back with git, and run this again.')
def setup(game, base=None):
    """Point the module at a game folder and read how its engine splits tiles, blocks and palettes."""
    global GAME, BASE, NT, NM, NP, NPAL
    GAME = os.path.abspath(game); BASE = base
    fm = os.path.join(GAME, 'include/fieldmap.h'); src = open(fm).read() if os.path.exists(fm) else ''
    d = lambda k, v: int(m.group(1)) if (m := re.search(r'#define %s\s+(\d+)' % k, src)) else v
    NT, NM, NP, NPAL = d('NUM_TILES_IN_PRIMARY', 512), d('NUM_METATILES_IN_PRIMARY', 512), d('NUM_PALS_IN_PRIMARY', 6), d('NUM_PALS_TOTAL', 13)

# ---------------------------------------------------------------- colour
def hexrgb(s):
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', str(s)): die(f'a colour is written #RRGGBB, got "{s}"')
    return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))
def use_profile(path):
    """Load the user's look. Returns the profile as read."""
    global RAMPS, PLATE, GAMMA
    pr = load_json(path)
    if not isinstance(pr, dict): die(f'{path}: the profile must be a JSON object ({{...}})')
    ramps = pr.get('ramps') or {}
    if len(ramps.get('neutral', [])) < 2: die(f'{path}: the profile needs "ramps" with at least "neutral": two or more colours, dark to light')
    for k, v in ramps.items():
        if k not in FAMILIES: die(f'{path}: unknown ramp "{k}". Ramps: {", ".join(FAMILIES)}')
        if len(v) < 2: die(f'{path}: ramp "{k}" needs two or more colours')
        [hexrgb(c) for c in v]
    plate = pr.get('plate') or {}
    if 'ground' not in plate: die(f'{path}: the profile needs "plate": {{"ground": "#RRGGBB"}} (and optionally "path", "floor")')
    RAMPS = {f: ramps.get(f, ramps['neutral']) for f in FAMILIES}
    PLATE = {r: plate.get(r, plate['ground']) for r in ('ground', 'path', 'floor')}; [hexrgb(c) for c in PLATE.values()]
    GAMMA = float(pr.get('gamma', 1.0))
    for role, t in (pr.get('treatments') or {}).items():
        if t not in ('flat', 'plate', 'reeds', 'slats', 'ripples', 'seams', 'keep'): die(f'{path}: unknown treatment "{t}" for {role}')
        TREAT[role] = t
    return pr
def lum(c): return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
def family(c):
    r, g, b = [v / 255 for v in c]
    h, l, s = colorsys.rgb_to_hls(r, g, b); h *= 360
    if s < 0.20 or l < 0.10 or l > 0.94: return 'neutral'
    if 65 <= h < 170: return 'green'
    if 170 <= h < 320: return 'blue'
    if h >= 330 or h < 10 or (h < 20 and s > 0.6 and l > 0.45): return 'red' if s >= 0.45 else 'warm'
    if 45 <= h < 65: return 'yellow'
    return 'warm'
def remap(c):
    ramp = [hexrgb(x) for x in RAMPS[family(c)]]
    t = (lum(c) ** GAMMA) * (len(ramp) - 1)
    i = min(int(t), len(ramp) - 2); f = t - i
    return tuple(round(ramp[i][k] + (ramp[i + 1][k] - ramp[i][k]) * f) for k in range(3))

# ---------------------------------------------------------------- files
def base_ref():
    global BASE
    if not BASE:
        BASE = os.environ.get('REDRAW_BASE') or subprocess.run(['git', '-C', GAME, 'rev-list', '--max-parents=0', 'HEAD'], capture_output=True, check=True).stdout.decode().split()[0]
    return BASE
def orig_path(rel):
    """The original of a file: from the base commit, kept under out/redraw_orig/. A file the base does not have (added
    since) is kept from disk the first time it is seen, so later runs still start from the same art."""
    p = os.path.join(GAME, 'out', 'redraw_orig', base_ref()[:12], rel)
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        r = subprocess.run(['git', '-C', GAME, 'show', base_ref() + ':' + rel], capture_output=True)
        data = r.stdout if r.returncode == 0 else open(os.path.join(GAME, rel), 'rb').read()
        if r.returncode != 0: print(f'  note: {rel} is not in the starting commit; its present state is kept as the original')
        with open(p, 'wb') as f: f.write(data)
    return p
def read_pal(path):
    lines = open(path).read().replace('\r', '').split('\n')
    return [tuple(map(int, l.split())) for l in lines[3:19]]
def write_pal(path, cols):
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f: f.write(('JASC-PAL\r\n0100\r\n16\r\n' + ''.join(f'{r} {g} {b}\r\n' for r, g, b in cols)).encode())
    os.replace(tmp, path)
def read_tiles(path):
    im = Image.open(path)
    if im.mode != 'P': die(f'{path} is not an indexed (16-colour) picture')
    w, h = im.size; px = im.load()
    return [[[px[tx * 8 + x, ty * 8 + y] & 15 for x in range(8)] for y in range(8)] for ty in range(h // 8) for tx in range(w // 8)], im
def write_tiles(path, tiles, like):
    im = like.copy(); px = im.load(); w = im.size[0] // 8
    for n, t in enumerate(tiles):
        for y in range(8):
            for x in range(8): px[(n % w) * 8 + x, (n // w) * 8 + y] = t[y][x]
    tmp = path + '.tmp.png'
    kw = {'bits': like.info['bits']} if 'bits' in like.info else {}
    im.save(tmp, format='PNG', **kw); os.replace(tmp, path)

class Tileset:
    """One tileset folder: tiles, palettes, building blocks (`per` tile entries each) and their attribute words."""
    def __init__(s, rel, pristine=True):
        s.rel = rel.rstrip('/'); s.name = os.path.basename(s.rel)
        src = orig_path if pristine else (lambda r: os.path.join(GAME, r))
        s.tiles, s.png = read_tiles(src(f'{s.rel}/tiles.png'))
        s.pals = []
        for n in range(16):
            f = f'{s.rel}/palettes/{n:02d}.pal'
            s.pals.append(read_pal(src(f)) if os.path.exists(os.path.join(GAME, f)) else [(0, 0, 0)] * 16)
        mb = open(os.path.join(GAME, s.rel, 'metatiles.bin'), 'rb').read(); ab = open(os.path.join(GAME, s.rel, 'metatile_attributes.bin'), 'rb').read()
        n8 = len(mb) // 16
        s.per = 8 if len(ab) in (n8 * 2, n8 * 4) else 12       # 12: three layers per block
        n = len(mb) // (2 * s.per); s.wide = len(ab) // max(n, 1) >= 4
        s.mt = [struct.unpack_from(f'<{s.per}H', mb, i * 2 * s.per) for i in range(n)]
        s.attr = [struct.unpack_from('<I' if s.wide else '<H', ab, i * (4 if s.wide else 2))[0] for i in range(n)]
        s.secondary = None
def layouts():
    return [l for l in load_json(os.path.join(GAME, 'data/layouts/layouts.json'))['layouts'] if l.get('id')]
_DIRS = {}
def tileset_dir(sym):
    """gTileset_X -> its folder, read from the tileset headers; else guessed from the name."""
    if not _DIRS:
        rd = lambda f: open(os.path.join(GAME, f)).read() if os.path.exists(os.path.join(GAME, f)) else ''
        gfx = rd('src/data/tilesets/graphics.h') + rd('src/graphics.c'); meta = rd('src/data/tilesets/metatiles.h')
        tiles = {m.group(1): m.group(2) for m in re.finditer(r'(gTilesetTiles_\w+)\[\]\s*=\s*\w+\("([^"]+)/tiles\.', gfx)}
        metas = {m.group(1): m.group(2) for m in re.finditer(r'(gMetatiles_\w+)\[\]\s*=\s*\w+\("([^"]+)/metatiles\.bin', meta)}
        for m in re.finditer(r'(gTileset_\w+)\s*=\s*\{(.*?)\}', rd('src/data/tilesets/headers.h'), re.S):
            t = re.search(r'\.tiles\s*=\s*(\w+)', m.group(2)); mt = re.search(r'\.metatiles\s*=\s*(\w+)', m.group(2))
            d = (mt and metas.get(mt.group(1))) or (t and tiles.get(t.group(1)))
            if d: _DIRS[m.group(1)] = d
    if sym not in _DIRS:
        snake = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', sym.replace('gTileset_', '')).lower()
        for k in ('primary', 'secondary'):
            if os.path.isdir(os.path.join(GAME, 'data/tilesets', k, snake)): _DIRS[sym] = f'data/tilesets/{k}/{snake}'
    if sym not in _DIRS: raise KeyError(sym)
    return _DIRS[sym]
def find_anims(rel, first):
    """Animated tiles of a tileset, read from src/tileset_anims.c: which tile slots each folder of frames overwrites.
    Returns (found, folders not understood)."""
    p = os.path.join(GAME, 'src/tileset_anims.c'); src = open(p).read() if os.path.exists(p) else ''
    dirs = {}
    for m in re.finditer(r'(gTilesetAnims_\w+?)_Frame\w*\[\]\s*=\s*\w+\("%s/(anim/[^/"]+)/' % re.escape(rel), src): dirs.setdefault(m.group(2), m.group(1))
    found = []; unknown = []
    for d, sym in sorted(dirs.items()):
        m = re.search(r'AppendTilesetAnimToBuffer\(\s*%s\[[^;]*?TILE_OFFSET_4BPP\(([^)]*)\)' % re.escape(sym), src)
        expr = m and m.group(1).replace('NUM_TILES_IN_PRIMARY', str(NT)).replace(' ', '')
        if expr and re.fullmatch(r'[\d+]+', expr): found.append(dict(dir=d, first_tile=sum(map(int, expr.split('+'))) - first))
        else: unknown.append(d)
    adir = os.path.join(GAME, rel, 'anim')
    unknown += [f'anim/{d}' for d in (sorted(os.listdir(adir)) if os.path.isdir(adir) else []) if f'anim/{d}' not in dirs]
    return found, unknown

# ---------------------------------------------------------------- redraw
def tile_roles(ts, roles, first):
    """Per tile: the role and the palette slot it is shown with most."""
    vote = defaultdict(Counter); pvote = defaultdict(Counter)
    for k, refs in enumerate(ts.mt):
        e = roles.get(str(k), {}); r = e.get('role', 'object'); wgt = e.get('used', 0) + 1
        for ref in refs:
            tid = (ref & 0x3FF) - first
            if 0 <= tid < len(ts.tiles): vote[tid][r] += wgt; pvote[tid][ref >> 12] += wgt
    return ({t: v.most_common(1)[0][0] for t, v in vote.items()}, {t: v.most_common(1)[0][0] for t, v in pvote.items()})

def flatten(t, pal, keep=None):
    """Remove hand-drawn texture: merge near-equal tones of one colour family, drop lone dots."""
    cnt = Counter(c for row in t for c in row if c)
    if not cnt: return [row[:] for row in t]
    fam = {c: family(pal[c]) for c in cnt}
    merged = {}
    for f in set(fam.values()):
        kept = []
        for c in sorted((c for c in cnt if fam[c] == f), key=lambda c: -cnt[c]):
            near = [k for k in kept if abs(lum(pal[k]) - lum(pal[c])) < 0.14 and k != keep]
            if near and c != keep: merged[c] = near[0]
            else: kept.append(c); merged[c] = c
    o = [[merged.get(c, c) if c else 0 for c in row] for row in t]
    for _ in range(2):                                  # drop isolated dots (speckle), keep lines
        n = [row[:] for row in o]
        for y in range(8):
            for x in range(8):
                c = o[y][x]
                if not c: continue
                nb = [o[yy][xx] for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)) if 0 <= xx < 8 and 0 <= yy < 8 and o[yy][xx]]
                if nb and c not in nb: n[y][x] = Counter(nb).most_common(1)[0][0]
        o = n
    return o

def redraw_tile(t, role, pal, ramp, plate_idx, dark_idx, ground_set=()):
    """t: 8x8 palette positions. ramp: this role's positions for this palette. Returns the new 8x8."""
    how = TREAT.get(role, 'flat')
    if how == 'keep': return [row[:] for row in t]
    if ground_set and plate_idx is not None:            # every bit of open ground, in any tile, becomes plate
        t = [[plate_idx if c in ground_set else c for c in row] for row in t]
    o = flatten(t, pal, keep=plate_idx)
    cnt = Counter(c for row in o for c in row if c)
    if not cnt or how == 'flat': return o
    if role not in ('ground', 'path', 'floor'):         # the object in this tile, not the ground around it
        obj = Counter({c: n for c, n in cnt.items() if c != plate_idx})
        if not obj: return o
        dom = obj.most_common(1)[0][0]
    else: dom = cnt.most_common(1)[0][0]
    dfam = family(pal[dom])
    same = [c for c in ramp if family(pal[c]) == dfam and c != plate_idx] or [dom]
    darker = [c for c in same if lum(pal[c]) < lum(pal[dom]) - 0.05]
    lighter = [c for c in same if lum(pal[c]) > lum(pal[dom]) + 0.05]
    if how == 'plate':
        if cnt[dom] >= 40:                              # flat fill, seam on the grid
            p = plate_idx if plate_idx is not None and family(pal[plate_idx]) == dfam else dom
            if lum(hexrgb(PLATE.get(role, PLATE['ground']))) < 0.25: seam = dark_idx      # on a dark plate the outline colour; on a light one the next darker tone, or none
            else:
                cand = [c for c in same if 0.03 < lum(pal[p]) - lum(pal[c]) < 0.25]
                seam = max(cand, key=lambda c: lum(pal[c])) if cand else None
            for y in range(8):
                for x in range(8):
                    if o[y][x] and family(pal[o[y][x]]) == dfam and abs(lum(pal[o[y][x]]) - lum(pal[dom])) < 0.25:
                        o[y][x] = seam if (y == 7 or x == 7) and seam is not None else p
    elif how == 'reeds':
        tones = sorted(same, key=lambda c: lum(pal[c])); hi = tones[-1]; mid = tones[len(tones) // 2]
        base = plate_idx if plate_idx is not None and family(pal[plate_idx]) == dfam else dom
        for y in range(8):
            for x in range(8):
                c = o[y][x]
                if c and family(pal[c]) == dfam:
                    top = {1: 1, 4: 3, 6: 0}.get(x)
                    o[y][x] = base if top is None or y < top else (hi if y == top else mid)
    elif how == 'slats':
        body = sorted([c for c in same if c != plate_idx] or same, key=lambda c: lum(pal[c]))
        if len(body) >= 2:
            outline = body[0] if len(body) >= 4 else None
            tones = [c for c in body if c != outline]; lo, mid, hi = tones[0], tones[len(tones) // 2], tones[-1]
            for y in range(8):
                for x in range(8):
                    c = o[y][x]
                    if c and c in body and c != outline: o[y][x] = hi if y % 4 == 0 else (lo if y % 4 == 3 else mid)
    elif how == 'ripples':
        hi = lighter[-1] if lighter else None
        for y in range(8):
            for x in range(8):
                c = o[y][x]
                if c and family(pal[c]) == dfam and abs(lum(pal[c]) - lum(pal[dom])) < 0.2: o[y][x] = dom
        if hi is not None and cnt[dom] >= 40:
            for x, y in ((1, 2), (2, 2), (3, 2), (5, 6), (6, 6)):
                if o[y][x] == dom: o[y][x] = hi
    elif how == 'seams':
        lo = darker[-1] if darker else None
        if lo is not None:
            for y in (3, 7):
                for x in range(8):
                    if o[y][x] == dom: o[y][x] = lo
    return o

def override_tile(t, kind, pal):
    """For tiles that carry a recognisable mark or lettering (roles.json "tile_overrides": {"<tile>": kind}).
    plain: wipe the figure to the tile's main colour. bar: wipe, then one printed bar. mark_top / mark_bottom: wipe,
    then the upper / lower squares of a small grid mark."""
    cnt = Counter(c for row in t for c in row if c)
    if not cnt: return [row[:] for row in t]
    order = [c for c, _ in cnt.most_common()]; dom = order[0]; dark = min(cnt, key=lambda c: lum(pal[c]))
    fig = [c for c in order[1:] if c != dark]
    accent = max(fig, key=lambda c: abs(lum(pal[c]) - lum(pal[dom]))) if fig else dark
    o = [[dom if c else 0 for c in row] for row in t]
    if kind == 'bar':
        for x in range(1, 7):
            for y in (3, 4):
                if o[y][x]: o[y][x] = accent
    elif kind in ('mark_top', 'mark_bottom'):
        for y in ((4, 5, 6) if kind == 'mark_top' else (1, 2, 3)):
            for x in (4, 5, 6):
                if o[y][x]: o[y][x] = accent
    return o

# ---------------------------------------------------------------- main
def restyle(rel, primary_rel, palette_only, strips):
    ts = Tileset(rel); prim = Tileset(primary_rel) if primary_rel else None
    secondary = prim is not None; first = NT if secondary else 0
    roles_path = os.path.join(GAME, rel, 'roles.json')
    if not os.path.exists(roles_path): die(f'{rel}/roles.json is missing. Run: kit tileset {ts.name} roles')
    doc = load_json(roles_path); roles = doc['metatiles']
    trole, tpal = tile_roles(ts, roles, first)
    pal_of = lambda slot: prim.pals[slot] if secondary and slot < NP else ts.pals[slot]
    use = defaultdict(Counter)                             # (role, palette) -> which positions that role uses
    for tid, r in trole.items():
        for row in ts.tiles[tid]:
            for c in row:
                if c: use[(r, tpal[tid])][c] += 1
    plate = {}; gset = defaultdict(set); cset = defaultdict(set)
    for (r, p), cnt in use.items():
        if r in ('ground', 'path', 'floor'):
            plate[(r, p)] = cnt.most_common(1)[0][0]
            tot = sum(cnt.values()); f0 = family(pal_of(p)[plate[(r, p)]])      # the plate colour and its texture companions
            comp = {c for c, n in cnt.items() if n / tot >= 0.10 and family(pal_of(p)[c]) == f0}
            if r == 'ground': gset[p] = comp
            cset[(r, p)] = comp
    dark = {p: min(range(1, 16), key=lambda c: lum(pal_of(p)[c])) for p in range(16)}
    def new_tile(t, tid, r, p):
        ramp = sorted(use[(r, p)], key=lambda c: lum(pal_of(p)[c]))
        return redraw_tile(t, r, pal_of(p), ramp, plate.get((r, p), plate.get(('ground', p))), dark[p], gset[p] if r != 'path' else ())
    overrides = doc.get('tile_overrides', {}); new_tiles = []; redrawn = 0
    for tid, t in enumerate(ts.tiles):
        if palette_only or tid not in trole: new_tiles.append([row[:] for row in t]); continue
        redrawn += 1
        if str(tid) in overrides: new_tiles.append(override_tile(t, overrides[str(tid)], pal_of(tpal[tid]))); continue
        new_tiles.append(new_tile(t, tid, trole[tid], tpal[tid]))
    own = range(NP, NPAL) if secondary else range(0, NP)
    new_pals = []
    for n in range(16):
        cols = [ts.pals[n][0]] + [remap(c) for c in ts.pals[n][1:]]; fixed = set()
        if n in own:
            for r in ('ground', 'path', 'floor'):
                for c in cset.get((r, n), ()): cols[c] = hexrgb(PLATE[r]); fixed.add(c)
                if (r, n) in plate:
                    p0 = ts.pals[n][plate[(r, n)]]; p1 = hexrgb(PLATE[r])
                    for c in range(1, 16):              # shadows and highlights drawn ON the plate follow it
                        c0 = ts.pals[n][c]
                        if c not in fixed and family(c0) == family(p0) and 0 < abs(lum(c0) - lum(p0)) < 0.13:
                            k = 1 + 2.2 * (lum(c0) - lum(p0))
                            cols[c] = tuple(max(0, min(255, round(v * k))) for v in p1); fixed.add(c)
                    cols[plate[(r, n)]] = p1; fixed.add(plate[(r, n)])
            for c in gset[n]: cols[c] = hexrgb(PLATE['ground'])
        new_pals.append(cols)
    write_tiles(os.path.join(GAME, rel, 'tiles.png'), new_tiles, ts.png)
    npal = 0
    for n in range(16):
        if os.path.exists(os.path.join(GAME, rel, 'palettes', f'{n:02d}.pal')): write_pal(os.path.join(GAME, rel, 'palettes', f'{n:02d}.pal'), new_pals[n]); npal += 1
    anims, unknown = (doc['anims'], []) if 'anims' in doc else find_anims(rel, first)
    frames = 0
    for a in anims:
        d = os.path.join(GAME, rel, a['dir'])
        for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if not fn.endswith('.png'): continue
            f = f"{rel}/{a['dir']}/{fn}"; tiles, png = read_tiles(orig_path(f)); out = []
            for k, t in enumerate(tiles):
                tid = a['first_tile'] + k; r = trole.get(tid, a.get('role', 'object')); p = tpal.get(tid, a.get('palette', 0))
                out.append(t if palette_only else new_tile(t, tid, r, p))
            write_tiles(os.path.join(GAME, f), out, png); frames += 1
    for spec in strips:                                     # loose pictures shown with one of this tileset's palettes (door frames)
        f, _, slot = spec.rpartition(':')
        if not f or not slot.isdigit(): die(f'--strips takes picture:palette-slot pairs, got "{spec}"')
        tiles, png = read_tiles(orig_path(f))
        write_tiles(os.path.join(GAME, f), [flatten(t, pal_of(int(slot))) for t in tiles], png); print(f'  flattened {f} (shown with palette {slot})')
    rc = Counter(v['role'] for v in roles.values())
    print(f'{rel}: {redrawn} of {len(ts.tiles)} tiles redrawn{" (palettes only: no tile changed)" if palette_only else ""}, {npal} palettes repainted, {frames} animation frames in {len(anims)} folders')
    print('  roles: ' + ', '.join(f'{n} {r}' for r, n in rc.most_common()))
    if unknown: print('  animation folders left as they are (their tile slots were not found; list them under "anims" in roles.json as {"dir": "anim/x", "first_tile": n}): ' + ', '.join(unknown))
    print(f'  original art read from commit {base_ref()[:8]} (kept under out/redraw_orig/)')

def main():
    a = sys.argv[1:]
    def val(k):
        if k not in a: return None
        i = a.index(k); v = a[i + 1] if i + 1 < len(a) else die(f'{k} needs a value'); del a[i:i + 2]; return v
    game, base, profile, primary, strips = val('--game'), val('--base'), val('--profile'), val('--primary'), val('--strips')
    palette_only = '--palette-only' in a
    rest = [x for x in a if not x.startswith('--')]
    if not game or not profile or len(rest) != 1: print(__doc__); sys.exit(1)
    setup(game, base); use_profile(profile)
    restyle(rest[0].rstrip('/'), primary.rstrip('/') if primary else None, palette_only, strips.split(',') if strips else [])

if __name__ == '__main__':
    main()
