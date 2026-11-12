#!/usr/bin/env python3
"""A first drawings file. Copy it into your game as tools/my_art.py, fill in the three lines marked FILL IN, then:

    kit redraw tools/my_art.py            previews only, in out/objects/ (nothing in the game changes)
    kit redraw tools/my_art.py --write    writes the drawing into the game; then kit build and kit shot

It redraws ONE house, 4 squares wide and 4 high, as a plain cream house with a red roof, a door and a window.
Find a house and its numbers with:  kit tileset <tileset name> objects   (it lists each whole thing, its size,
the map and square where one stands, and where its door is). Change the drawing, then add more functions like
house() for other things, one entry in GROUPS each.
"""
from objects import Im   # the kit's small canvas: rect, box, hl, vl, px, text, art (see the top of the kit's objects.py)

# FILL IN: the SHARED sheet of the map (kit maps shows "tilesets <shared> + <own>"). The kit reads this name to
# know which pair of sheets the map is drawn with; the house's own tiles are found on whichever sheet holds them.
PRIMARY = 'data/tilesets/primary/general'
MAP, X, Y = 'YourMap', 0, 0                 # FILL IN: the map, and the top-left square of the house on it
LORE = 'your-town'                          # FILL IN: the lore id of the place (kit lore new your-town "YOUR TOWN")

# one letter per colour; every drawing call takes a letter
COLOURS = {'K': '#28202C', 'W': '#F0E8D8', 'S': '#D8CCB4', 'R': '#C84838', 'D': '#A03428', 'B': '#7C5030', 'G': '#88C0D8'}


def house(run):
    im = Im(64, 64)                          # 4 x 4 squares of 16 dots
    # roof: two rows of squares, darker bottom course, a lighter ridge, an eave that overhangs by one dot
    im.rect(2, 2, 60, 28, 'R'); im.hl(2, 2, 60, 'K'); im.vl(1, 3, 27, 'K'); im.vl(62, 3, 27, 'K')
    for y in range(8, 28, 6): im.hl(3, y, 58, 'D')             # tile courses
    im.rect(0, 28, 64, 3, 'D'); im.hl(0, 31, 64, 'K')          # the eave and its shadow line
    # wall
    im.rect(2, 32, 60, 30, 'W'); im.hl(2, 32, 60, 'S'); im.box(1, 31, 62, 32, 'K')
    # door on the second square from the left, bottom row (move it to where the original's door is: the square
    # the player walks into does not move, only the picture does)
    im.rect(20, 46, 12, 16, 'B'); im.box(19, 45, 14, 18, 'K'); im.px(29, 54, 'W')
    # window
    im.rect(40, 40, 14, 10, 'G'); im.box(39, 39, 16, 12, 'K'); im.vl(46, 40, 10, 'K')
    # ground=: what shows through where the picture is empty; here the map's plain ground block (0x001 is usually it;
    # kit redraw dump <map> x y w h shows the block ids at a place)
    run.claim('house', MAP, X, Y, im, ground=run.ground_of(MAP, 0x001))


GROUPS = [{'name': 'house', 'lore': LORE, 'draw': house}]
