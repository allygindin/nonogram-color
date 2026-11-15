# Nonogram Color

A color nonogram puzzle game for iPhone, built as an offline web app (PWA).
Plain HTML/CSS/JavaScript with no framework, no dependencies, and no build step to play.

## Play it on your iPhone

1. Deploy to GitHub Pages (below) and open the URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the home screen. It runs full-screen, and once it has opened
   one time it works fully offline. The service worker caches every file and every level.

## Deploy to GitHub Pages

```sh
git add -A && git commit -m "Nonogram Color"
git remote add origin git@github.com:<you>/nonogram-color.git
git push -u origin main
```

Then on GitHub go to **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**.
The site is served from `https://<you>.github.io/nonogram-color/`. All paths are relative, so it
works from a subfolder. `.nojekyll` stops GitHub from processing the files.

## Develop locally

```sh
npm run serve        # http://localhost:8080 plus a LAN address for your phone
npm test             # unit tests (clue generation, line solver vs brute force, game rules)
```

Over plain `http://` on your LAN, iOS won't enable the service worker. Test offline install on the
HTTPS GitHub Pages URL. URL helpers: `?play=<level-id>` opens a puzzle directly, and `?reset` clears saved progress.

## Adding puzzles

Every shipped puzzle must have exactly one solution that line logic alone can reach.
`tools/validate.mjs` enforces this.

**Option A: ASCII art.** Add an entry to `tools/levels-src.mjs`, then:

```sh
npm run levels       # writes levels/<id>.json from the ASCII art
npm run validate     # validates all levels, writes levels/index.json, refreshes sw.js
```

**Option B: JSON by hand.** Drop a file in `levels/` (format below) and run `npm run validate`.

**Option C: from an image.** Run `npm run serve` and open `http://localhost:8080/tools/convert.html`.
Pick an image, the grid size (5, 10, 15 or 20) and the number of colors. The image is fitted into a square. Ambiguous cells are hatched: click cells to
edit them, or press Auto-fix. Download the JSON into `levels/`, then run `npm run validate`.

If a level fails, the validator prints a map with `?` on every cell that logic can't pin down.
Change a pixel or two near those cells and run it again.

**Always run `npm run validate` before deploying.** It regenerates the service worker's file list and
version. Without that, installed phones won't pick up new levels or code.

### Level format

```json
{
  "id": "cat-01",
  "name": "Cat",
  "category": "Animals",
  "width": 10,
  "height": 10,
  "palette": ["#ef6a12", "#2b2d42", "#ff5d8f"],
  "solution": [[0,1,0,0,0,0,0,0,1,0], "...one array per row..."]
}
```

`0` = empty, `1..K` = palette index (1-based). Clues are computed when a level loads and are never stored.
Every puzzle is square, and its size sets its difficulty: **5×5 Easy, 10×10 Medium, 15×15 Hard,
20×20 Expert**. The validator rejects any other size.

## How it's organized

| File | What it does |
| --- | --- |
| `js/clues.js` | Clue generation (shared with the Node tools) |
| `js/solver.js` | DP line solver plus whole-grid propagation used by the validator |
| `js/generate.js` | Random puzzle generator (blobby symmetric pictures, checked with the solver) |
| `js/game.js` | Rules: strokes with row/column lock, undo, auto-X, lives, hints, win check |
| `js/view.js` | Canvas renderer: pinned clues, zoom/pan, magnifier, overview map, win reveal |
| `js/input.js` | Touch handling: 1 finger paints, 2 fingers pinch/pan |
| `js/app.js` | Screens, HUD, saving to localStorage |
| `sw.js` | Offline cache (file list maintained by `tools/validate.mjs`) |
| `tools/` | Validator, level builder, icon generator, image converter, tests, dev server |

## Gameplay notes

- **Win check** compares clues, not cells, so a valid alternate solution also wins.
- **Lives mode** (on by default, toggle in the menu) checks each placement against the stored solution.
  A wrong placement costs a life. The cell is then locked showing its true value (a red X for an
  empty cell, a red corner for a filled one). The drag stops at that cell.
- **Used-up colors** (lives mode): once a color is placed everywhere it belongs, its swatch fades with a
  check mark and can't be selected. The selection moves to the next color still needed.
- **Placed cells are safe in lives mode.** Every placement is checked, so tapping or dragging over a
  colored cell or an X never clears or changes it and never costs a life. Strokes only fill empty cells.
- **Drag rule (no-lives mode):** the first cell decides the action. Painting over empty cells fills only empty cells, and
  starting on a cell of the selected color clears only that color. A drag never wipes out other work.
  An X drag that starts on a colored cell marks the empty cells it crosses.
- **Clue numbers gray out one at a time.** The first and last numbers gray as soon as a matching block
  is colored at that end of the line. A middle number grays once every block between it and one
  end is colored too. The whole line grays and fills with X when it matches its clue exactly.
- **Random puzzles:** the Easy / Medium / Hard / Expert buttons above the level list make a new
  puzzle (5×5, 10×10, 15×15, 20×20). Each one is an abstract, often mirrored pattern that the
  solver has confirmed has one solution reachable by logic alone. One unfinished random puzzle per
  difficulty is kept, so its button says **Continue**. Solved ones are thrown away. "New random
  puzzle" in the menu swaps the current one for a fresh one.
- **Hints** prefer cells in the most nearly-solved row or column. A cell you filled wrongly
  (in no-lives mode) is fixed first.
