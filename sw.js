/* Cachea sólo el "armazón" de la app (código e imágenes) para que abra sin conexión.
   Los datos siempre se piden a OneDrive: nunca se guarda una copia acá. */
const CACHE = 'prestamos-v2';
const ARCHIVOS = ['./', './index.html', './app.js', './nube.js', './xlsx.js',
  './logo.jpg', './logo2.jpg', './pagare.jpg', './icon-192.png', './icon-512.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== location.origin) return;               // Graph y login siempre a la red
  e.respondWith(
    fetch(e.request).then(r => {
      const copia = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
