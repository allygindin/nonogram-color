// Hand-made pixel-art levels, drawn as ASCII for easy editing.
// `node tools/build-levels.mjs` turns these into levels/<id>.json.
// '.' = empty; every other letter maps to a palette color via `colors`
// (palette order = order of keys in `colors`).

const C = {
  red: '#e63946',
  darkRed: '#a4161a',
  pink: '#ff5d8f',
  orange: '#ef6a12',
  amber: '#e3b000',
  leaf: '#40a060',
  forest: '#2d6a4f',
  blue: '#3a7ca5',
  navy: '#1d3557',
  brown: '#8d5524',
  tan: '#c68642',
  ink: '#2b2d42',
  steel: '#7d8597',
  purple: '#7b2cbf',
};

export default [
  {
    id: 'heart-01', name: 'Heart', category: 'Symbols',
    colors: { R: C.red, P: C.pink },
    art: `
.R.R.
RPRRR
RRRRR
.RRR.
..R..`,
  },
  {
    id: 'smile-01', name: 'Smiley', category: 'Symbols',
    colors: { Y: C.amber, K: C.ink },
    art: `
.YYY.
YKYKY
YYYYY
YKKKY
.YYY.`,
  },
  {
    id: 'sprout-01', name: 'Sprout', category: 'Nature',
    colors: { G: C.leaf, B: C.brown },
    art: `
GG.GG
.GGG.
..G..
BBBBB
.BBB.`,
  },
  {
    id: 'mushroom-01', name: 'Mushroom', category: 'Nature',
    colors: { R: C.red, S: C.tan, G: C.forest },
    art: `
.RRR.
RRRRR
..S..
..S..
GGSGG`,
  },
  {
    id: 'duck-01', name: 'Duck', category: 'Animals',
    colors: { Y: C.amber, O: C.orange, K: C.ink, B: C.blue },
    art: `
..YYY...
.YYKY...
.YYYYOO.
..YY....
.YYYYYY.
YYYYYYYY
.YYYYYY.
BBBBBBBB`,
  },
  {
    id: 'cherries-01', name: 'Cherries', category: 'Food',
    colors: { G: C.leaf, R: C.red, P: C.pink },
    art: `
....GGG.
....G.G.
...GG.G.
..G...G.
.RR..RR.
RPRRRPRR
RRRRRRRR
.RR..RR.`,
  },
  {
    id: 'flower-01', name: 'Flower', category: 'Nature',
    colors: { P: C.pink, Y: C.amber, G: C.leaf },
    art: `
..PPP...
.PPYPP..
.PYYYP..
.PPYPP..
..PPP...
...G.GG.
...GGG..
...G....`,
  },
  {
    id: 'cat-01', name: 'Cat', category: 'Animals',
    colors: { O: C.orange, K: C.ink, P: C.pink },
    art: `
.O......O.
.OO....OO.
.OOOOOOOO.
OOOOOOOOOO
OOKOOOOKOO
OOKOOOOKOO
OOOOPPOOOO
.OOOOOOOO.
..OOOOOO..
...OOOO...`,
  },
  {
    id: 'fish-01', name: 'Fish', category: 'Animals',
    colors: { O: C.orange, A: C.amber, D: C.darkRed, K: C.ink, B: C.blue },
    art: `
...AAAA...
..OOOOOO.A
.OKOOOOOAA
OOOOODOOAA
OOOOODOOOA
.OOOODOOAA
..OOOOOO.A
...AA.....
..B....B..
BBBBBBBBBB`,
  },
  {
    id: 'icecream-01', name: 'Ice Cream', category: 'Food',
    colors: { R: C.red, P: C.pink, M: C.leaf, C: C.tan },
    art: `
....RR....
...PPPP...
..PPPPPP..
..PPPPPP..
..MMMMMM..
.MMMMMMMM.
.CCCCCCCC.
..CCCCCC..
...CCCC...
....CC....`,
  },
  {
    id: 'house-01', name: 'House', category: 'Objects',
    colors: { R: C.darkRed, T: C.tan, B: C.blue, K: C.brown, G: C.leaf },
    art: `
....RR....
...RRRR...
..RRRRRR..
.RRRRRRRR.
RRRRRRRRRR
.TTTTTTTT.
.TBBTTKKT.
.TBBTTKKT.
.TTTTTKKT.
GGGGGGGGGG`,
  },
  {
    id: 'tree-01', name: 'Apple Tree', category: 'Nature',
    colors: { G: C.leaf, D: C.forest, R: C.red, B: C.brown },
    art: `
...GGGG...
..GGRGGG..
.GGGGGGRG.
GGRGGGGGGG
GGGGGDGRGG
.GGGGGGGG.
..GGBBGG..
....BB....
....BB....
..BBBBBB..`,
  },
  {
    id: 'rocket-01', name: 'Rocket', category: 'Objects',
    colors: { R: C.red, S: C.steel, B: C.blue, O: C.orange, Y: C.amber },
    art: `
.......R.......
......RRR......
.....RRRRR.....
.....SSSSS.....
....SSSSSSS....
....SSBBBSS....
....SBBBBBS....
....SSBBBSS....
....SSSSSSS....
....SSSSSSS....
...RSSSSSSSR...
..RRSSSSSSSRR..
.RRR.OOOOO.RRR.
.RR...OYO...RR.
.......Y.......`,
  },
  {
    id: 'owl-01', name: 'Owl', category: 'Animals',
    colors: { B: C.brown, T: C.tan, Y: C.amber, K: C.ink, O: C.orange },
    art: `
...BB.....BB...
...BBB...BBB...
...BBBBBBBBB...
..BBBBBBBBBBB..
..BYYYBBBYYYB..
..YYKYYBYYKYY..
..BYYYBOBYYYB..
..BBBBBOBBBBB..
.BBBTTTTTTTBBB.
.BBTTBTTTBTTBB.
.BBTTTTTTTTTBB.
.BBTTBTTTBTTBB.
..BBTTTTTTTBB..
...BBBBBBBBB...
....OO...OO....`,
  },
  {
    id: 'lighthouse-01', name: 'Lighthouse', category: 'Objects',
    colors: { Y: C.amber, K: C.ink, R: C.red, S: C.steel, G: C.leaf, B: C.blue },
    art: `
....................
.........KK.........
........KKKK........
YYYYYY..YYYY..YYYYYY
........YYYY........
........KKKK........
.......KKKKKK.......
........RRRR........
........RRRR........
........SSSS........
.......SSSSSS.......
.......RRRRRR.......
.......RRRRRR.......
.......SSSSSS.......
......SSSSSSSS......
......RRRRRRRR......
......RRKKRRRR......
...GGGGGKKGGGGGG....
BBBGGGGGGGGGGGGGGBBB
BBBBBBBBBBBBBBBBBBBB`,
  },
];
