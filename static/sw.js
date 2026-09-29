// Usual Order service worker: caches the app shell only.
// Data (Supabase, a different origin) is never cached — those requests pass straight through.
const CACHE = 'usual-shell-v1';
const SHELL = [
	'/',
	'/manifest.webmanifest',
	'/favicon.svg',
	'/icon-180.png',
	'/icon-192.png',
	'/icon-512.png',
	'/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then(async (cache) => {
				await cache.addAll(SHELL);
				// Also grab the hashed entry scripts/styles the shell HTML references,
				// so the app can boot offline on the very next launch.
				try {
					const html = await (await cache.match('/')).text();
					const assets = [...html.matchAll(/["']((?:\.{1,2}\/|\/)*_app\/immutable\/[^"']+)["']/g)].map(
						(m) => new URL(m[1], self.location.origin + '/').pathname
					);
					await cache.addAll([...new Set(assets)]);
				} catch {
					// Best effort; assets get cached on first use anyway.
				}
			})
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return; // Supabase etc.: let the network handle it

	// Page loads (any deep link is the same SPA shell): network first, fall back to cached '/'.
	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(CACHE).then((cache) => cache.put('/', copy));
					}
					return res;
				})
				.catch(() => caches.match('/').then((cached) => cached || Response.error()))
		);
		return;
	}

	// Content-hashed build assets never change: cache first.
	if (url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(
			caches.match(req).then(
				(cached) =>
					cached ||
					fetch(req).then((res) => {
						if (res.ok) {
							const copy = res.clone();
							caches.open(CACHE).then((cache) => cache.put(req, copy));
						}
						return res;
					})
			)
		);
		return;
	}

	// Shell files (icons, manifest): cache first, otherwise network.
	if (SHELL.includes(url.pathname)) {
		event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
	}
});
