#!/usr/bin/env python3
"""Replace whole multi-tile objects of an existing tileset by NEW drawings of the same footprint. Run through
`kit redraw <art module> [--write] [--only group,group]`; `kit redraw dump <map> x y w h` prints the blocks at a place.

The second way to restyle (the first, kit/restyle.py, repaints fills by role: run it first). Nothing here reads the
original dots of an object. An object is found on a map as a block of building blocks (metatiles); each says which 8x8
tile sits where (per layer, with its flip and palette); a new drawing is cut up and written into exactly those tile
positions. With claim, direct, door and strip, maps and building blocks are never written, so the object keeps its
footprint, its solid squares, its door square and what the player walks behind.

The art module is the user's own file in their game (for example tools/my_art.py). It holds the drawings and says
where they go; the kit holds none. What it must have:

  PRIMARY = 'data/tilesets/primary/<name>'        the shared sheet the drawings are shown with
  COLOURS = {'K': '#101018', 'B': '#f0e8d8'}      one letter per colour, used by the drawing calls
  def house(run):                                  one function per group; `run` is a Run (below)
      im = Im(80, 80); im.rect(0, 16, 80, 64, 'B'); im.box(0, 16, 80, 64, 'K')
      run.claim('house', 'MyTown', 5, 3, im, ground=run.ground_of('MyTown', 0x001))
  GROUPS = [{'name': 'house', 'lore': 'my-town', 'draw': house}]      'lore' is the lore id the drawing belongs to

(A module with a main(write, only) function and no GROUPS is run as it is.)

How a drawing reaches the tiles (class Run):
 - claim(name, map, x, y, picture, ground): the squares under the picture, from (x, y), now show the picture. One
   picture = each 8x8 cell goes into the top tile where the original had a top tile of its own, else the bottom one.
   Give `top=` (same size) to choose yourself: `top` is drawn over the player where the block is of that kind.
 - A tile is written only if the claims OWN it: at least 80% of its use on maps is inside claimed blocks, or it is in
   the claim's explicit `tiles` list. Shared ground tiles are left alone.
 - Bottom tiles are written whole: the drawing over the ground the claim names. Top tiles get only the drawing.
 - A tile wanted with different dots at different places takes the version wanted most often; the clashes are printed
   and the preview shows what the game will really draw. Design drawings so a shared tile agrees everywhere.
 - direct(name, tile, slot, picture, x, y, ground): write one tile straight from an 8x8 of a picture (objects
   described tile by tile, such as a tree used in many arrangements).
 - door(png, picture, slots) and strip(png, picture, slot): door frames and tileset animation frames.
 - set_colour(tileset, slot, position, colour): force one palette entry. Otherwise the colours the drawings need go
   into palette positions no untouched tile uses; if a palette runs out, the nearest colour is used and it is said.
 - append, remap, repal, reserve: NEW building blocks drawn from a picture and put on the map in place of the old
   ones (each square keeps what it does; collision is not touched). These DO write the map's block ids and the
   tileset's block files; appended.json beside the tileset records the originals, and every run starts from them.
Without --write nothing is written: previews go to out/objects/.
"""
import importlib.util, json, os, re, struct, sys
from collections import Counter, defaultdict
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import restyle as R

def out_dir(): return os.path.join(R.GAME, 'out', 'objects')
def q5(c): return tuple(v & 0xF8 for v in c[:3])            # what the console shows (5 bits a channel)
COL = {}                                                    # letter -> (r, g, b), filled from the art module's COLOURS

FONT = {
    'A': '.X.X.XXXXX.XX.X', 'B': 'XX.X.XXX.X.XXX.', 'C': '.XXX..X..X...XX', 'D': 'XX.X.XX.XX.XXX.', 'E': 'XXXX..XX.X..XXX',
    'F': 'XXXX..XX.X..X..', 'G': '.XXX..X.XX.X.XX', 'H': 'X.XX.XXXXX.XX.X', 'I': 'XXX.X..X..X.XXX', 'K': 'X.XX.XXX.X.XX.X',
    'L': 'X..X..X..X..XXX', 'M': 'X.XXXXXXXX.XX.X', 'N': 'XX.X.XX.XX.XX.X', 'O': '.X.X.XX.XX.X.X.', 'P': 'XX.X.XXX.X..X..',
    'R': 'XX.X.XXX.X.XX.X', 'S': '.XXX...X...XXX.', 'T': 'XXX.X..X..X..X.', 'U': 'X.XX.XX.XX.XXXX', 'V': 'X.XX.XX.XX.X.X.',
    'W': 'X.XX.XXXXXXXX.X', 'Y': 'X.XX.X.X..X..X.', ' ': '...............', '1': '.X.XX..X..X.XXX', '0': 'XXXX.XX.XX.XXXX',
}

class Im:
    """A small RGBA canvas. Colours are letters of COL or (r, g, b)."""
    def __init__(s, w, h, fill=None):
        s.w, s.h = w, h; s.im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); s.p = s.im.load()
        if fill is not None: s.rect(0, 0, w, h, fill)
    def c(s, ch): return (COL[ch] if isinstance(ch, str) else tuple(ch[:3])) + (255,)
    def px(s, x, y, ch):
        if 0 <= x < s.w and 0 <= y < s.h: s.p[x, y] = s.c(ch) if ch is not None else (0, 0, 0, 0)
    def rect(s, x, y, w, h, ch):
        for j in range(y, y + h):
            for i in range(x, x + w): s.px(i, j, ch)
    def box(s, x, y, w, h, ch):
        s.rect(x, y, w, 1, ch); s.rect(x, y + h - 1, w, 1, ch); s.rect(x, y, 1, h, ch); s.rect(x + w - 1, y, 1, h, ch)
    def hl(s, x, y, n, ch): s.rect(x, y, n, 1, ch)
    def vl(s, x, y, n, ch): s.rect(x, y, 1, n, ch)
    def art(s, x, y, rows, key=None):
        for j, r in enumerate(rows):
            for i, ch in enumerate(r):
                if ch not in '. ': s.px(x + i, y + j, (key or {}).get(ch, ch))
    def text(s, x, y, t, ch):
        for k, lt in enumerate(t):
            g = FONT[lt]
            for i in range(15):
                if g[i] == 'X': s.px(x + k * 4 + i % 3, y + i // 3, ch)
    def blit(s, o, x, y):
        s.im.alpha_composite(o.im if isinstance(o, Im) else o, (x, y)) if 0 <= x and 0 <= y and x + o.w <= s.w and y + o.h <= s.h else s._blit_clip(o, x, y)
        s.p = s.im.load()
    def _blit_clip(s, o, x, y):
        op = o.p
        for j in range(o.h):
            for i in range(o.w):
                v = op[i, j]
                if v[3] and 0 <= x + i < s.w and 0 <= y + j < s.h: s.p[x + i, y + j] = v
    def flipx(s):
        o = Im(s.w, s.h); o.im = s.im.transpose(Image.FLIP_LEFT_RIGHT); o.p = o.im.load(); return o
    def sub(s, x, y, w, h):
        o = Im(w, h); o.im = s.im.crop((x, y, x + w, y + h)); o.p = o.im.load(); return o
    def copy(s): return s.sub(0, 0, s.w, s.h)
    def mirror_left(s):
        """Make the picture symmetric: the right half becomes the mirror of the left half."""
        for j in range(s.h):
            for i in range(s.w // 2): s.p[s.w - 1 - i, j] = s.p[i, j]
        return s

# ------------------------------------------------------------------ world
class World:
    """Every tileset shown together with one primary, as it is on disk now, changed in memory."""
    def __init__(s, prim_rel):
        s.prim_rel = prim_rel; s.sheets = {}; s.lays = []; s.secs = set()
        for lay in R.layouts():
            if lay.get('layout_version', 'emerald') != 'emerald': continue    # the other engine family splits its ids differently: not handled
            try: pd, sd = R.tileset_dir(lay['primary_tileset']), R.tileset_dir(lay['secondary_tileset'])
            except Exception: continue
            if pd != prim_rel or not os.path.exists(os.path.join(R.GAME, lay['blockdata_filepath'])): continue
            s.lays.append((lay, sd)); s.secs.add(sd)
        s.prim = s.sheet(prim_rel)
        s.placed = Counter(); s._grid = {}
        for lay, sd in s.lays:
            for row in s.grid(lay['id']):
                for mid in row: s.placed[(prim_rel, mid) if mid < R.NM else (sd, mid - R.NM)] += 1
        s.use = defaultdict(Counter)                       # tile key -> {metatile key: weight}
        for rel in [prim_rel] + sorted(s.secs):
            t = s.sheet(rel)
            for k, refs in enumerate(t.mt):
                wgt = s.placed[(rel, k)] + 0.01
                for ref in refs: s.use[s.tkey(rel, ref & 0x3FF)][(rel, k)] += wgt
    def sheet(s, rel):
        if rel not in s.sheets:
            t = s.sheets[rel] = R.Tileset(rel, pristine=False)
            if t.per != 8: R.die(f'{rel} keeps three layers per building block; replacing objects handles two')
            side = s.side(rel)
            if side:                                        # forget what an earlier run appended: every run re-appends
                del t.mt[side['base_metatiles']:]; del t.attr[side['base_metatiles']:]; del t.tiles[side['base_tiles']:]
        return s.sheets[rel]
    def side(s, rel):
        """The record of appended metatiles of a tileset (appended.json beside it), or None."""
        if not hasattr(s, '_side'): s._side = {}
        if rel not in s._side:
            p = os.path.join(R.GAME, rel, 'appended.json')
            s._side[rel] = R.load_json(p) if os.path.exists(p) else None
        return s._side[rel]
    def lid(s, name):
        """A layout id from what the art module wrote: the layout id itself, or a map's name."""
        if any(l[0]['id'] == name for l in s.lays): return name
        p = os.path.join(R.GAME, 'data/maps', name, 'map.json')
        lid = R.load_json(p).get('layout') if os.path.exists(p) else None
        if not any(l[0]['id'] == lid for l in s.lays): R.die(f'"{name}" is not a map or layout that uses {s.prim_rel}')
        return lid
    def lay(s, lid): return [l for l in s.lays if l[0]['id'] == lid][0]
    def grid(s, lid):
        if lid not in s._grid:
            lay, _ = s.lay(lid); data = open(os.path.join(R.GAME, lay['blockdata_filepath']), 'rb').read(); W = lay['width']
            s._grid[lid] = [[struct.unpack_from('<H', data, (y * W + x) * 2)[0] & 0x3FF for x in range(W)] for y in range(lay['height'])]
            side = s.side(s.lay(lid)[1])
            for x, y, orig in (side or {}).get('swaps', {}).get(lid, []): s._grid[lid][y][x] = orig     # the map as it was before any swap
        return s._grid[lid]
    def tkey(s, sec_rel, tid): return (s.prim_rel, tid) if tid < R.NT else (sec_rel, tid - R.NT)
    def pkey(s, sec_rel, slot): return (s.prim_rel, slot) if slot < R.NP else (sec_rel, slot)
    def mt(s, sec_rel, mid):
        """-> (metatile key, refs, attribute)"""
        rel, k = (s.prim_rel, mid) if mid < R.NM else (sec_rel, mid - R.NM); t = s.sheet(rel)
        if k >= len(t.mt): return (rel, k), (0,) * 8, 0
        return (rel, k), t.mt[k], t.attr[k]
    def render(s, lid, region=None):
        lay, sd = s.lay(lid); g = s.grid(lid); sec = s.sheet(sd)
        im = Image.new('RGB', (lay['width'] * 16, lay['height'] * 16)); px = im.load()
        for sy, row in enumerate(g):
            for sx, mid in enumerate(row):
                _, refs, _ = s.mt(sd, mid)
                for li, ref in enumerate(refs):
                    tid = ref & 0x3FF; hf = (ref >> 10) & 1; vf = (ref >> 11) & 1; pal = ref >> 12
                    src = s.prim if tid < R.NT else sec; tn = tid if tid < R.NT else tid - R.NT
                    if tn >= len(src.tiles): continue
                    t = src.tiles[tn]; cols = (s.prim if pal < R.NP else sec).pals[pal]
                    ox, oy = sx * 16 + (li % 2) * 8, sy * 16 + ((li % 4) // 2) * 8
                    for y in range(8):
                        for x in range(8):
                            c = t[7 - y if vf else y][7 - x if hf else x]
                            if c: px[ox + x, oy + y] = cols[c]
        if region: x, y, w, h = region; im = im.crop((x * 16, y * 16, (x + w) * 16, (y + h) * 16))
        return im
    def mt_image(s, sec_rel, mid, layers=(0, 1)):
        """16x16 RGBA of a metatile as it is now (for sampling the ground under an object)."""
        _, refs, _ = s.mt(sec_rel, mid); im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); px = im.load()
        for li, ref in enumerate(refs):
            if li // 4 not in layers: continue
            tid = ref & 0x3FF; hf = (ref >> 10) & 1; vf = (ref >> 11) & 1; pal = ref >> 12
            rel, tn = s.tkey(sec_rel, tid); t = s.sheet(rel)
            if tn >= len(t.tiles): continue
            prel, _ = s.pkey(sec_rel, pal); cols = s.sheet(prel).pals[pal]
            for y in range(8):
                for x in range(8):
                    c = t.tiles[tn][7 - y if vf else y][7 - x if hf else x]
                    if c: px[(li % 2) * 8 + x, ((li % 4) // 2) * 8 + y] = cols[c] + (255,)
        return im

class Claim:
    def __init__(s, name, lid, squares, bot, top, ground, origin=(0, 0), tiles=None, auto=False):
        s.name, s.lid, s.squares, s.bot, s.top, s.ground, s.origin, s.tiles, s.auto = name, lid, squares, bot, top, ground, origin, tiles, auto

class Run:
    def __init__(s, prim_rel, write=False):
        s.w = World(prim_rel); s.write = write; s.claims = []; s.report = []; s.previews = []
        s.extra_lock = defaultdict(set); s.pal_set = {}; s.directs = []; s.doors = []; s.appends = []; s.remaps = []; s.reserved = defaultdict(set); s.force = set()
    # ---- declaring
    def ground_of(s, lid, mid):
        """A ground function sampling metatile `mid` (bottom layer) as it is drawn now."""
        _, sd = s.w.lay(s.w.lid(lid)); im = s.w.mt_image(sd, mid, layers=(0,)).load()
        return lambda x, y: im[x % 16, y % 16][:3]
    def claim(s, name, lid, x, y, img, ground='G', top=None, tiles=None, squares=None):
        """img: Im covering the squares from (x, y); w and h come from its size. One picture =
        automatic layer choice per cell. Give `top` (same size) to choose the layers yourself."""
        w, h = img.w // 16, img.h // 16
        sq = squares if squares is not None else [(x + i, y + j) for j in range(h) for i in range(w)]
        g = (lambda px, py, c=COL[ground]: c) if isinstance(ground, str) else ground
        s.claims.append(Claim(name, s.w.lid(lid), sq, img, top, g, (x, y), tiles, auto=top is None))
    def door(s, png, im, slots, sec_rel=None):
        """A door animation strip (graphics/door_anims/*.png, 16 x 96: three frames of 16 x 32,
        each 2 x 4 tiles). im: the three frames as they should look; slots: the palette slot of
        each of the 8 tiles of a frame (the table in src/field_door.c)."""
        s.doors.append((png, im, slots, sec_rel))
    def strip(s, png, im, slot, sec_rel=None):
        """Any other indexed picture shown with one tileset palette slot (tileset animation
        frames): im is written tile by tile; open pixels become index 0."""
        s.doors.append((png, im, (slot,) * 8, sec_rel))
    def append(s, name, lid, x, y, img, slot, ground='w', mode='all', top=None):
        """Draw NEW metatiles for the squares under `img` and put them on the map (allowed since
        round 8 for pure visual replacements). Each square keeps the attribute word (behaviour,
        layer kind) of the metatile it replaces; collision and elevation bits of the map are not
        touched. mode 'all': bottom layer = the picture over `ground`, top layer = `top` or
        empty. mode 'bottom': only the bottom layer is redrawn, the old top layer is kept (floor
        under table rims). One palette slot per call. Appended tiles and metatiles are recorded
        in appended.json beside the tileset so every run starts again from the original map."""
        g = (lambda px, py, c=COL[ground]: c) if isinstance(ground, str) else ground
        s.appends.append((name, s.w.lid(lid), x, y, img, slot, g, mode, top))
    def remap(s, name, lid, tiles, slot=None):
        """Give one map its own version of an object of the SHARED sheet: every square of `lid`
        whose metatile shows one of the shared tiles in `tiles` {tile id: (Im, x, y, ground or
        None)} gets a new metatile with the same structure (layers, flips, attribute) in which
        those tiles are replaced by new ones drawn from the given 8x8. Other maps keep the
        shared object. The new tiles keep the old palette slot unless `slot` is given."""
        s.remaps.append((name, s.w.lid(lid), tiles, slot))
    def reserve(s, rel, tiles):
        """Sheet tile slots an appended tile must never take (slots a tileset animation writes into)."""
        s.reserved[rel] |= set(tiles)
    def repal(s, lid, from_slot, to_slot, squares=None):
        """Show one map's shared-sheet art through another palette slot: every square of `lid`
        (or of `squares`) whose metatile uses palette `from_slot` gets a new metatile that is the
        same in everything but that palette number. No tile is copied. Runs after the appends."""
        s.remaps.append(('repal', s.w.lid(lid), (from_slot, to_slot, squares), None))
    def lock(s, rel, slot, indices): s.extra_lock[(rel, slot)] |= set(indices)
    def set_colour(s, rel, slot, index, colour):
        """Force one palette entry (for plate and path tones that tiles outside the claims use)."""
        s.pal_set[(rel, slot, index)] = COL[colour] if isinstance(colour, str) else colour
        s.w.sheet(rel).pals[slot][index] = tuple(s.pal_set[(rel, slot, index)])
    def direct(s, name, tid, slot, im, x=0, y=0, ground=None, sec_rel=None):
        """Write one tile straight from the 8x8 at (x, y) of `im`, for objects described tile by
        tile (trees). ground: None = a top-layer tile (transparent where the picture is), else a
        function (i, j) -> rgb for the pixels the picture leaves open."""
        s.directs.append((name, tid, slot, im, x, y, ground, sec_rel))
    def preview(s, name, places, scale=3): s.previews.append((name, [(s.w.lid(p[0]),) + tuple(p[1:]) for p in places], scale))
    # ---- doing
    def run(s):
        w = s.w
        owned_mt = set(); explicit = set()
        for c in s.claims:
            _, sd = w.lay(c.lid); g = w.grid(c.lid)
            for (x, y) in c.squares:
                if 0 <= y < len(g) and 0 <= x < len(g[0]): owned_mt.add(w.mt(sd, g[y][x])[0])
            c.exp = {(w.prim_rel if t < R.NT else sd, t if t < R.NT else t - R.NT) for t in c.tiles} if c.tiles is not None else None
        own_cache = {}
        def owns(key, c):
            if key == (w.prim_rel, 0) or key[1] >= len(w.sheet(key[0]).tiles): return False
            if c.exp is not None: return key in c.exp
            if key not in own_cache:
                u = w.use.get(key, {}); tot = sum(u.values())
                own_cache[key] = tot > 0 and sum(v for k, v in u.items() if k in owned_mt) / tot >= 0.8
            return own_cache[key]
        wants = defaultdict(lambda: defaultdict(Counter))  # tile key -> priority -> {(pal key, pixels): count}
        where = {}; lost = Counter()
        def cell(canvas, c, sx, sy, q):
            if canvas is None: return None
            ox, oy = (sx - c.origin[0]) * 16 + (q % 2) * 8, (sy - c.origin[1]) * 16 + (q // 2) * 8
            if ox < 0 or oy < 0 or ox + 8 > canvas.w or oy + 8 > canvas.h: return None
            p = canvas.p; out = [p[ox + i, oy + j] for j in range(8) for i in range(8)]
            return out if any(v[3] >= 128 for v in out) else None
        def unflip(pix, hf, vf):
            return tuple(pix[(7 - j if vf else j) * 8 + (7 - i if hf else i)] for j in range(8) for i in range(8))
        for c in s.claims:
            _, sd = w.lay(c.lid); g = w.grid(c.lid)
            for (sx, sy) in c.squares:
                if not (0 <= sy < len(g) and 0 <= sx < len(g[0])): continue
                _, refs, _ = w.mt(sd, g[sy][sx])
                for q in range(4):
                    rb, rt = refs[q], refs[4 + q]
                    kb, kt = w.tkey(sd, rb & 0x3FF), w.tkey(sd, rt & 0x3FF)
                    ob, ot = owns(kb, c), owns(kt, c)
                    if c.auto:
                        a = cell(c.bot, c, sx, sy, q); wb, wt = (None, a) if ot else (a, None)
                    else:
                        wb, wt = cell(c.bot, c, sx, sy, q), cell(c.top, c, sx, sy, q)
                    if wt is not None and not ot:              # no top tile of its own here: fold down
                        if ob: wb = [t if t[3] >= 128 else b for t, b in zip(wt, wb)] if wb else wt
                        elif c.exp is None: lost[c.name] += 1
                        wt = None
                    if ot:
                        pix = tuple((v[0] & 0xF8, v[1] & 0xF8, v[2] & 0xF8) if v[3] >= 128 else None for v in (wt or [(0, 0, 0, 0)] * 64))
                        pr = 2 if wt else 0
                        key = (w.pkey(sd, rt >> 12), unflip(pix, (rt >> 10) & 1, (rt >> 11) & 1))
                        wants[kt][pr][key] += 1; where.setdefault((kt, key), (c.name, c.lid, sx, sy))
                    if ob:
                        px0, py0 = sx * 16 + (q % 2) * 8, sy * 16 + (q // 2) * 8
                        pix = tuple(q5(wb[n]) if wb and wb[n][3] >= 128 else q5(c.ground(px0 + n % 8, py0 + n // 8)) for n in range(64))
                        pr = 2 if wb else 1
                        key = (w.pkey(sd, rb >> 12), unflip(pix, (rb >> 10) & 1, (rb >> 11) & 1))
                        wants[kb][pr][key] += 1; where.setdefault((kb, key), (c.name, c.lid, sx, sy))
                    elif wb is not None and c.exp is None: lost[c.name] += 1
        # choose one version per tile
        chosen = {}; clashes = []
        for tk, byp in wants.items():
            pr = max(byp); best, n = byp[pr].most_common(1)[0]
            chosen[tk] = best
            if len(byp[pr]) > 1:
                tot = sum(byp[pr].values())
                clashes.append((tot - n, tot, tk, [where[(tk, k)] for k, _ in byp[pr].most_common(3)]))
        for name, tid, slot, im, x0, y0, ground, sec_rel in s.directs:
            pix = []
            for j in range(8):
                for i in range(8):
                    v = im.p[x0 + i, y0 + j]
                    pix.append(q5(v) if v[3] >= 128 else (q5(ground(i, j)) if ground else None))
            chosen[w.tkey(sec_rel, tid)] = (w.pkey(sec_rel, slot), tuple(pix))
        # palettes
        need = defaultdict(Counter)
        for png, im, slots, sec_rel in s.doors:
            tw = im.w // 8
            for n in range(tw * (im.h // 8)):
                pk = w.pkey(sec_rel, slots[n % 8])
                for j in range(8):
                    for i in range(8):
                        v = im.p[(n % tw) * 8 + i, (n // tw) * 8 + j]
                        if v[3] >= 128: need[pk][q5(v)] += 1
        for tk, (pk, pix) in chosen.items():
            for v in pix:
                if v is not None: need[pk][v] += 1
        for name, lid, tmap, slot in s.remaps:
            if name == 'repal' or slot is None: continue
            pk = w.pkey(w.lay(lid)[1], slot)
            for im in {id(v[0]): v[0] for v in tmap.values()}.values():
                for cnt, v in (im.im.getcolors(4096) or []):
                    if v[3] >= 128: need[pk][q5(v)] += cnt
        for name, lid, x0, y0, img, slot, ground, mode, top in s.appends:
            pk = w.pkey(w.lay(lid)[1], slot)
            for im in (img, top):
                if im is None: continue
                for cnt, v in (im.im.getcolors(4096) or []):
                    if v[3] >= 128: need[pk][q5(v)] += cnt
        locked = defaultdict(set)
        for rel in [w.prim_rel] + sorted(w.secs):
            t = w.sheet(rel)
            for k, refs in enumerate(t.mt):
                if not w.placed[(rel, k)]: continue        # never placed on a map: cannot be seen
                for ref in refs:
                    tk = w.tkey(rel, ref & 0x3FF)
                    if tk in chosen or tk == (w.prim_rel, 0): continue
                    src = w.sheet(tk[0])
                    if tk[1] >= len(src.tiles): continue
                    pk = w.pkey(rel, ref >> 12)
                    for row in src.tiles[tk[1]]: locked[pk].update(row)
        for pk, idx in s.extra_lock.items(): locked[pk] |= idx
        for (rel, slot, index), col in s.pal_set.items(): locked[(rel, slot)].add(index)
        pal_note = []
        for pk in sorted(need):
            rel, slot = pk; pal = w.sheet(rel).pals[slot]
            lk = locked[pk] - {0}; free = [i for i in range(1, 16) if i not in lk]
            have = {q5(pal[i]) for i in lk}
            todo = [c for c, _ in need[pk].most_common() if c not in have]
            for c, i in zip(todo, free): pal[i] = c
            if len(todo) > len(free):
                pal_note.append(f'{rel} slot {slot}: {len(todo)} new colours wanted, {len(free)} free indices; the {len(todo) - len(free)} least used are matched to the nearest: ' + ' '.join('%02X%02X%02X' % c for c in todo[len(free):]))
            for i in free[len(todo):]: pal[i] = pal[i]
        # write tiles (index space)
        worst = Counter(); n_written = Counter()
        for tk, (pk, pix) in chosen.items():
            sh = w.sheet(tk[0]); pal = [q5(c) for c in w.sheet(pk[0]).pals[pk[1]]]
            look = {}
            def idx(v):
                if v is None: return 0
                if v not in look:
                    i = min(range(1, 16), key=lambda i: sum((pal[i][k] - v[k]) ** 2 for k in range(3)))
                    look[v] = i; e = sum((pal[i][k] - v[k]) ** 2 for k in range(3)) ** 0.5
                    if e > worst[pk]: worst[pk] = e
                return look[v]
            sh.tiles[tk[1]] = [[idx(pix[j * 8 + i]) for i in range(8)] for j in range(8)]
            n_written[tk[0]] += 1
        # appended metatiles
        app = {}                                            # sheet rel -> state
        for name, lid, x0, y0, img, slot, ground, mode, top in s.appends:
            _, sd = w.lay(lid); sh = w.sheet(sd); g = w.grid(lid)
            if sd not in app:
                side = w.side(sd)
                st = app[sd] = dict(base_tiles=side['base_tiles'] if side else len(sh.tiles), base_mt=side['base_metatiles'] if side else len(sh.mt),
                                    declared=side['declared'] if side else None, swaps=defaultdict(list), pool={}, new_mt={})
                # a sheet tile is free if no metatile that is still placed somewhere (after this run's swaps) shows it
                gone = defaultdict(set)
                for a in s.appends:
                    if w.lay(a[1])[1] != sd: continue
                    for j in range(a[4].h // 16):
                        for i in range(a[4].w // 16):
                            if a[8] is not None or any(a[4].p[i * 16 + u, j * 16 + v][3] >= 128 for u in range(16) for v in range(16)): gone[a[1]].add((a[2] + i, a[3] + j))
                still = set()
                for lay2, sd2 in w.lays:
                    if sd2 != sd: continue
                    for y, row in enumerate(w.grid(lay2['id'])):
                        for x, m in enumerate(row):
                            if m >= R.NM and (x, y) not in gone[lay2['id']]: still.add(m - R.NM)
                    bp = os.path.join(R.GAME, lay2.get('border_filepath', ''))
                    if os.path.isfile(bp):
                        bd = open(bp, 'rb').read()
                        still |= {(struct.unpack_from('<H', bd, k)[0] & 0x3FF) - R.NM for k in range(0, len(bd), 2) if (struct.unpack_from('<H', bd, k)[0] & 0x3FF) >= R.NM}
                used = {(r & 0x3FF) - R.NT for k, refs in enumerate(sh.mt[:st['base_mt']]) if k in still for r in refs if (r & 0x3FF) >= R.NT}
                used |= {tk[1] for tk in chosen if tk[0] == sd} | s.reserved[sd]
                if 'all' in s.reserved[sd]: used |= {(r & 0x3FF) - R.NT for refs in sh.mt[:st['base_mt']] for r in refs if (r & 0x3FF) >= R.NT}   # sheets whose metatiles the engine places by id at run time
                st['free'] = [i for i in range(st['base_tiles']) if i not in used]
            st = app[sd]; pal = [q5(c) for c in sh.pals[slot]] if slot >= R.NP else [q5(c) for c in w.prim.pals[slot]]
            def tile_of(pix):                               # pix: 64 of rgb or None
                def idx(v):
                    if v is None: return 0
                    return min(range(1, 16), key=lambda i: sum((pal[i][k] - v[k]) ** 2 for k in range(3)))
                rows = tuple(tuple(idx(pix[j * 8 + i]) for i in range(8)) for j in range(8))
                for fl in range(4):                         # the same tile mirrored counts as the same tile
                    alt = tuple(tuple(r[::-1]) if fl & 1 else r for r in (rows[::-1] if fl & 2 else rows))
                    if alt in st['pool']: return st['pool'][alt] | (fl << 10)
                if st['free']: n = st['free'].pop(0); sh.tiles[n] = [list(r) for r in rows]
                else: n = len(sh.tiles); sh.tiles.append([list(r) for r in rows])
                st['pool'][rows] = n
                return n
            for j in range(img.h // 16):
                for i in range(img.w // 16):
                    sx, sy = x0 + i, y0 + j; orig = g[sy][sx]; _, refs, attr = w.mt(sd, orig)
                    if not any(img.p[i * 16 + a, j * 16 + b][3] >= 128 for a in range(16) for b in range(16)) and top is None: continue
                    new = []
                    for q in range(4):
                        px0, py0 = i * 16 + (q % 2) * 8, j * 16 + (q // 2) * 8
                        cellpx = [img.p[px0 + n % 8, py0 + n // 8] for n in range(64)]
                        if all(v[3] < 128 for v in cellpx) and (refs[q] & 0x3FF) not in (0,) and mode == 'all' and ground is not None and getattr(ground, 'keep', True):
                            new.append(refs[q]); continue          # nothing drawn here: the square keeps its own ground tile
                        pix = [q5(v) if v[3] >= 128 else q5(ground(sx * 16 + (q % 2) * 8 + n % 8, sy * 16 + (q // 2) * 8 + n // 8))
                               for n, v in enumerate(cellpx)]
                        new.append((R.NT + tile_of(pix)) | (slot << 12))        # (tile_of may carry flip bits 10 and 11)
                    for q in range(4):
                        if mode == 'bottom': new.append(refs[4 + q]); continue
                        px0, py0 = i * 16 + (q % 2) * 8, j * 16 + (q // 2) * 8
                        pix = [(q5(v) if v[3] >= 128 else None) for v in (top.p[px0 + n % 8, py0 + n // 8] for n in range(64))] if top else [None] * 64
                        new.append(((R.NT + tile_of(pix)) | (slot << 12)) if any(v is not None for v in pix) else 0)
                    key = (tuple(new), attr)
                    if key not in st['new_mt']:
                        st['new_mt'][key] = len(sh.mt); sh.mt.append(tuple(new)); sh.attr.append(attr)
                    if not any((x_, y_) == (sx, sy) for x_, y_, _ in st['swaps'][lid]): st['swaps'][lid].append([sx, sy, orig])   # only the block that was there before any swap
                    g[sy][sx] = R.NM + st['new_mt'][key]
        for name, lid, tmap, slot in s.remaps:
            _, sd = w.lay(lid); sh = w.sheet(sd); g = w.grid(lid)
            if sd not in app: R.die('remap and repal need an append on the same sheet first (it sets up the free tile list)')
            st = app[sd]; made = {}
            if name == 'repal':
                a, b, only_sq = tmap
                for sy, row in enumerate(g):
                    for sx, orig in enumerate(row):
                        if only_sq is not None and (sx, sy) not in only_sq: continue
                        _, refs, attr = w.mt(sd, orig)
                        if not any((r >> 12) == a and (r & 0x3FF) for r in refs): continue
                        new = tuple((r & 0x0FFF) | (b << 12) if (r >> 12) == a and (r & 0x3FF) else r for r in refs)
                        key = (new, attr)
                        if key not in st['new_mt']:
                            st['new_mt'][key] = len(sh.mt); sh.mt.append(new); sh.attr.append(attr)
                        first = next((o for x_, y_, o in st['swaps'][lid] if (x_, y_) == (sx, sy)), None)
                        if first is None: st['swaps'][lid].append([sx, sy, orig])
                        g[sy][sx] = R.NM + st['new_mt'][key]
                continue
            def new_tile(tid, pslot):
                if (tid, pslot) not in made:
                    im, x0, y0, ground = tmap[tid]; pal = [q5(c) for c in (sh.pals[pslot] if pslot >= R.NP else w.prim.pals[pslot])]
                    def idx(v, i, j):
                        if v[3] < 128:
                            if ground is None: return 0
                            v = ground(i, j)
                        v = q5(v); return min(range(1, 16), key=lambda k: sum((pal[k][c] - v[c]) ** 2 for c in range(3)))
                    rows = [[idx(im.p[x0 + i, y0 + j], i, j) for i in range(8)] for j in range(8)]
                    if st['free']: n = st['free'].pop(0); sh.tiles[n] = rows
                    else: n = len(sh.tiles); sh.tiles.append(rows)
                    made[(tid, pslot)] = n
                return made[(tid, pslot)]
            for sy, row in enumerate(g):
                for sx, orig in enumerate(row):
                    _, refs, attr = w.mt(sd, orig)
                    if not any((r & 0x3FF) in tmap for r in refs): continue
                    new = tuple(((R.NT + new_tile(r & 0x3FF, slot if slot is not None else r >> 12)) | (r & 0x0C00) | ((slot if slot is not None else r >> 12) << 12)) if (r & 0x3FF) in tmap else r for r in refs)
                    key = (new, attr)
                    if key not in st['new_mt']:
                        st['new_mt'][key] = len(sh.mt); sh.mt.append(new); sh.attr.append(attr)
                    if not any((x_, y_) == (sx, sy) for x_, y_, _ in st['swaps'][lid]): st['swaps'][lid].append([sx, sy, orig])   # only the block that was there before any swap
                    g[sy][sx] = R.NM + st['new_mt'][key]
            st['pool'].update({('remap', name, k): v for k, v in made.items()})
        for sd, st in app.items():
            sh = w.sheet(sd)
            if len(sh.tiles) > R.NT or len(sh.mt) > R.NM: R.die(f'{sd}: over the limit of {R.NT} tiles and {R.NM} building blocks: {len(sh.tiles)} tiles, {len(sh.mt)} blocks. Nothing was written.')
            print(f'  appended to {os.path.basename(sd)}: {len(st["new_mt"])} metatiles ({len(sh.mt)} of {R.NM} used), {len(st["pool"])} tiles '
                  f'({len(st["free"])} free slots left in the sheet, sheet now {len(sh.tiles)} of {R.NT}), {sum(len(v) for v in st["swaps"].values())} map squares swapped')
        door_out = []
        for png, im, slots, sec_rel in s.doors:
            tiles = []; tw = im.w // 8
            for n in range(tw * (im.h // 8)):
                pk = w.pkey(sec_rel, slots[n % 8]); pal = [q5(c) for c in w.sheet(pk[0]).pals[pk[1]]]
                def idx(v):
                    if v[3] < 128: return 0
                    v = q5(v)
                    i = min(range(1, 16), key=lambda i: sum((pal[i][k] - v[k]) ** 2 for k in range(3)))
                    e = sum((pal[i][k] - v[k]) ** 2 for k in range(3)) ** 0.5
                    if e > worst[pk]: worst[pk] = e
                    return i
                tiles.append([[idx(im.p[(n % tw) * 8 + i, (n // tw) * 8 + j]) for i in range(8)] for j in range(8)])
            door_out.append((png, tiles))
        # report
        print(f'{w.prim_rel}: {len(s.claims)} claims, {sum(n_written.values())} tiles drawn ' + str(dict((os.path.basename(k), v) for k, v in n_written.items())))
        for name, n in lost.items(): print(f'  LOST: {name}: {n} cells have drawing but no tile of their own to hold it')
        clashes.sort(reverse=True)
        if clashes: print(f'  {len(clashes)} tiles wanted with different pixels at different places (most common version used):')
        for minority, tot, tk, ws in clashes[:40]:
            print(f'    {os.path.basename(tk[0])} tile {tk[1]}: {minority} of {tot} uses differ; ' + '; '.join(f'{n} {l.replace("LAYOUT_", "")} ({x},{y})' for n, l, x, y in ws))
        for n in pal_note: print('  PALETTE:', n)
        for pk, e in worst.items():
            if e > 12: print(f'  PALETTE: {os.path.basename(pk[0])} slot {pk[1]}: worst colour error {e:.0f}')
        os.makedirs(out_dir(), exist_ok=True)
        for name, places, scale in s.previews:
            ims = [w.render(p[0], p[1:] if len(p) > 1 else None) for p in places]
            out = Image.new('RGB', (sum(i.width for i in ims) + 8 * (len(ims) - 1), max(i.height for i in ims)), (60, 0, 60)); ox = 0
            for i in ims: out.paste(i, (ox, 0)); ox += i.width + 8
            out.resize((out.width * scale, out.height * scale), Image.NEAREST).save(os.path.join(out_dir(), name + '.png'))
        if s.write:
            for rel, sh in w.sheets.items():
                if (n_written[rel] or rel in s.force) and rel not in app and not w.side(rel): R.write_tiles(os.path.join(R.GAME, rel, 'tiles.png'), sh.tiles, sh.png)
            for rel in {pk[0] for pk in need} | {k[0] for k in s.pal_set}:
                sh = w.sheet(rel)
                for n in range(16): R.write_pal(os.path.join(R.GAME, rel, 'palettes', f'{n:02d}.pal'), sh.pals[n])
            for png, tiles in door_out:
                path = os.path.join(R.GAME, png); R.write_tiles(path, tiles, Image.open(path))
            # appended metatiles, grown sheets, swapped map squares (and squares swapped by an earlier run put back)
            for sd in set(app) | {rel for rel in w.sheets if w.side(rel)}:
                sh = w.sheet(sd); st = app.get(sd); side = w.side(sd) or {}
                gh = os.path.join(R.GAME, 'src/data/tilesets/graphics.h'); src = open(gh).read()
                m = re.search(r'("%s/tiles\.png", "[^"]*", "-num_tiles )(\d+)' % re.escape(sd), src)
                declared = side.get('declared') or (st and st['declared']) or (int(m.group(2)) if m else None)   # only trees that state a tile count have the line
                top_used = max(declared or 0, len(sh.tiles)) if st and st['pool'] else declared   # every tile of the sheet is loaded once something is appended
                if m and int(m.group(2)) != top_used:
                    src = src[:m.start(2)] + str(top_used) + src[m.end(2):]
                    tmp = gh + '.tmp'; open(tmp, 'w').write(src); os.replace(tmp, gh)
                if len(sh.tiles) * 64 != sh.png.size[0] * sh.png.size[1]:
                    im = Image.new('P', (128, (len(sh.tiles) + 15) // 16 * 8)); im.putpalette(sh.png.getpalette()); im.info.update({k: v for k, v in sh.png.info.items() if k == 'bits'}); sh.png = im
                R.write_tiles(os.path.join(R.GAME, sd, 'tiles.png'), sh.tiles + [[[0] * 8] * 8] * (sh.png.size[0] * sh.png.size[1] // 64 - len(sh.tiles)), sh.png)
                for fn, data in (('metatiles.bin', b''.join(struct.pack('<8H', *r) for r in sh.mt)), ('metatile_attributes.bin', b''.join(struct.pack('<I' if sh.wide else '<H', a) for a in sh.attr))):
                    tmp = os.path.join(R.GAME, sd, fn + '.tmp'); open(tmp, 'wb').write(data); os.replace(tmp, os.path.join(R.GAME, sd, fn))
                lids = set(side.get('swaps', {})) | set(st['swaps'] if st else ())
                for lid in lids:
                    lay, _ = w.lay(lid); path = os.path.join(R.GAME, lay['blockdata_filepath']); data = bytearray(open(path, 'rb').read()); g = w.grid(lid)
                    for y, row in enumerate(g):
                        for x, mid in enumerate(row):
                            o = (y * lay['width'] + x) * 2; v = struct.unpack_from('<H', data, o)[0]; struct.pack_into('<H', data, o, (v & 0xFC00) | mid)
                    tmp = path + '.tmp'; open(tmp, 'wb').write(bytes(data)); os.replace(tmp, path)
                rec = dict(about='Written by kit redraw: what was appended to this tileset and which map squares were swapped (x, y, original block id).',
                           base_tiles=st['base_tiles'] if st else side['base_tiles'], base_metatiles=st['base_mt'] if st else side['base_metatiles'],
                           declared=declared, swaps={k: v for k, v in (st['swaps'] if st else {}).items()})
                tmp = os.path.join(R.GAME, sd, 'appended.json.tmp')
                with open(tmp, 'w') as f: json.dump(rec, f)
                os.replace(tmp, os.path.join(R.GAME, sd, 'appended.json'))
            print('  written')
        else: print('  dry run (previews only); --write to write')
        return chosen

def dump(lid, x, y, w, h):
    p = os.path.join(R.GAME, 'data/maps', lid, 'map.json')
    if os.path.exists(p): lid = R.load_json(p)['layout']
    lay = [l for l in R.layouts() if l['id'] == lid] or R.die(f'no map or layout named {lid}')
    W = World(R.tileset_dir(lay[0]['primary_tileset'])); _, sd = W.lay(lid); g = W.grid(lid)
    print(f'{lid}: blocks at ({x},{y}) {w}x{h} (hex ids; {R.NM:x} and up are the second tileset\'s)')
    for j in range(y, y + h): print(' '.join(f'{g[j][i]:4x}' for i in range(x, x + w)))
    print('each block: its kind (layer type), what it does, then its four bottom and four top tiles as number, h/v flip, palette')
    seen = set()
    for j in range(y, y + h):
        for i in range(x, x + w):
            m = g[j][i]
            if m in seen: continue
            seen.add(m); _, refs, attr = W.mt(sd, m)
            f = lambda r: f'{r & 0x3FF:4d}{"h" if r >> 10 & 1 else " "}{"v" if r >> 11 & 1 else " "}p{r >> 12:<2d}'
            print(f'{m:4x} kind {attr >> 12} beh {attr & 255:3d} | bot', ' '.join(f(r) for r in refs[:4]), '| top', ' '.join(f(r) for r in refs[4:]))

def apply(art, write, only):
    """Load the user's art module and run its groups, one Run per shared sheet."""
    spec = importlib.util.spec_from_file_location('art', art); mod = importlib.util.module_from_spec(spec)
    sys.modules['objects'] = sys.modules[__name__]; sys.path.insert(0, os.path.dirname(os.path.abspath(art)))
    spec.loader.exec_module(mod)
    COL.update({k: R.hexrgb(v) if isinstance(v, str) else tuple(v) for k, v in getattr(mod, 'COLOURS', {}).items()})
    groups = getattr(mod, 'GROUPS', None)
    if groups is None:
        if not hasattr(mod, 'main'): R.die(f'{art} has neither GROUPS nor main(write, only). See the top of kit/objects.py for what an art module holds.')
        return mod.main(write=write, only=only)
    names = [g['name'] for g in groups]
    for o in only or []:
        if o not in names: R.die(f'no group "{o}" in {art}. Groups: {", ".join(names)}')
    if write and only: print('  note: a write always runs every group (appended blocks are rebuilt from the original map each time)'); only = None
    by = defaultdict(list)
    for g in groups:
        prim = g.get('primary') or getattr(mod, 'PRIMARY', None) or R.die(f'{art}: set PRIMARY (the shared sheet), or "primary" on the group {g["name"]}')
        if not only or g['name'] in only: by[prim.rstrip('/')].append(g)
    for prim, gs in by.items():
        run = Run(prim, write); done = []
        for g in gs:
            n0 = (len(run.claims), len(run.directs), len(run.doors), len(run.appends), len(run.remaps))
            g['draw'](run)
            n1 = (len(run.claims), len(run.directs), len(run.doors), len(run.appends), len(run.remaps))
            parts = [f'{b - a} {w}' for a, b, w in zip(n0, n1, ('placed drawings', 'tiles written one by one', 'door or animation strips', 'pictures put on the map as new blocks', 'per-map versions')) if b > a]
            done.append((g, ', '.join(parts) or 'nothing declared'))
            if not any(p[0] == g['name'] for p in run.previews):
                places = [(c.lid, min(x for x, _ in c.squares) - 1, min(y for _, y in c.squares) - 1, max(x for x, _ in c.squares) - min(x for x, _ in c.squares) + 3, max(y for _, y in c.squares) - min(y for _, y in c.squares) + 3) for c in run.claims[n0[0]:n1[0]]][:3]
                places = [(l, max(0, x), max(0, y), w, h) for l, x, y, w, h in places]
                if places: run.previews.append((g['name'], places, 3))
        run.run()
        for g, what in done:
            print(f'  group {g["name"]}{" (lore: " + g["lore"] + ")" if g.get("lore") else ""}: {what}')
            if write and g.get('lore'): print(f'LINEAGE\t{g["lore"]}\t{g["name"]}\t{what}')
        for name, _, _ in run.previews: print(f'  preview: {os.path.join(out_dir(), name + ".png")}')

if __name__ == '__main__':
    a = sys.argv[1:]
    if '--game' not in a or len(a) < 3: print(__doc__); sys.exit(1)
    i = a.index('--game'); game = a[i + 1]; del a[i:i + 2]
    base = None
    if '--base' in a: i = a.index('--base'); base = a[i + 1]; del a[i:i + 2]
    R.setup(game, base)
    if a[0] == 'dump':
        if len(a) != 6: R.die('dump needs a map and a rectangle: dump <map> <x> <y> <w> <h>')
        dump(a[1], *map(int, a[2:6]))
    else:
        only = a[a.index('--only') + 1].split(',') if '--only' in a else None
        apply(os.path.abspath(a[0]), '--write' in a, only)
