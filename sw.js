// Service worker: precaches the whole app (code, icons, every level) so it
// runs fully offline once installed. `node tools/validate.mjs` regenerates the
// file list and VERSION below; a new VERSION makes phones fetch a fresh copy.
const VERSION = '1c2682c898a0';
const CACHE = `nonogram-color-${VERSION}`;
const ASSETS = [
  // <assets>
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/clues.js',
  './js/color.js',
  './js/game.js',
  './js/generate.js',
  './js/input.js',
  './js/level.js',
  './js/solver.js',
  './js/storage.js',
  './js/version.js',
  './js/view.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './levels/index.json',
  './levels/heart-01.json',
  './levels/smile-01.json',
  './levels/sprout-01.json',
  './levels/mushroom-01.json',
  './levels/cat-01.json',
  './levels/flower-01.json',
  './levels/tree-01.json',
  './levels/cherries-01.json',
  './levels/duck-01.json',
  './levels/icecream-01.json',
  './levels/fish-01.json',
  './levels/house-01.json',
  './levels/owl-01.json',
  './levels/rocket-01.json',
  './levels/lighthouse-01.json',
  // </assets>
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nonogram-color-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first; fall back to network (and cache what we fetch). Navigations
// always fall back to the cached app shell when offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = (await cache.match('./index.html')) || (await cache.match('./'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
