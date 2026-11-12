# Charm Shop

Maps `CharmShop` and `RibbonRoom` (group `gMapGroup_CharmShop`). CharmShop uses its own tileset
`gTileset_CharmShopCyber` (cyber look, below); RibbonRoom still uses `gTileset_CharmShop`.

## Cyber look (CharmShop, draft, not yet seen in the game)

An underground charm atelier: chrome counter with a pink acrylic front, two pink glass cases of
electronic charms (heart circuit board, star chip, crescent antenna), a chunky CRT terminal, an
arched server door with steady pink side lights, a capsule rack, and pink ribbon cable running in
floor channels from the server door to the exit. Nothing on the map moves or blinks.
Pieces: `tools/cyber_shop.py` (objects cut from the approved cyber atlas, floor/walls drawn in code).

## Earlier look (RibbonRoom only)

Mood: a small, calm shop in pink and sage where everything is made by hand.

- Colours: pale pink walls with a rose trim line, pink glass cases, sage octagon floor, the
  potted plant left green.
- Motif: rows of small things: charms in glass cases at the front, ribbon racks at the back.
- Drawn: the engine's indoor shop pieces in a new layout, with the tileset's palettes
  recoloured (`tools/charm_rooms.py`). The keeper still uses an engine sprite.

## Voice

The charm keeper talks in short, warm sentences and points you at the next thing to see.
Never sells hard, never names prices. Lives behind the counter of the front room.

## Easter eggs

- RibbonRoom (5,4), words: the rack reads "Pink, sage, pink, sage...": the room's own palette.

## Links

## Lineage

- CharmShop: newly generated object atlas adapted into native tiles; floors and walls drawn in code.
- RibbonRoom: engine shop pieces with copied and recoloured palettes. Characters remain engine art.
- The original engine shop maps are unchanged. No content comes from the ongoing game.
