// Keeps a copy of the Round Tracker on the phone, so reopening it with no signal (a dead zone,
// Safari dropping the tab, the home-screen icon) still opens the score screen.
//
// - Registered by round_tracker.js with scope ./round_tracker, so it only ever handles the tracker
//   page and the files that page asks for. Every other page on the site is untouched.
// - Network first: with signal, everything loads exactly as it would without this file. The copy
//   is only used when the network fails, or hangs past NET_WAIT_MS.
// - The database (*.supabase.co) is never cached or touched: scores still go through the
//   tracker's own outbox.
// - Nothing to bump on a deploy: whatever the page last loaded with signal is what's kept.
//   Change CACHE only to throw the whole copy away.
const CACHE = 'bbb-tracker-v1';
const PAGE = new URL('round_tracker.html', self.location).href;
const NET_WAIT_MS = 4000;
// Once the page itself came from the copy, its files skip the wait too
const OFFLINE_HOLD_MS = 30000;
const HOSTS = new Set([self.location.host, 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);

let offlineUntil = 0;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n.startsWith('bbb-tracker-') && n !== CACHE).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

const keeps = url => HOSTS.has(url.host) && url.href !== self.location.href;

// A response the browser will accept back for any request (a redirected one can't answer a page load)
async function plain(res) {
    if (!res.redirected) return res;
    return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Same-origin files carry ?v=: keep only the newest copy of each
async function store(key, res) {
    if (!res || !res.ok) return;
    const cache = await caches.open(CACHE);
    const url = new URL(typeof key === 'string' ? key : key.url);
    if (url.origin === self.location.origin) {
        const old = await cache.keys(url.origin + url.pathname, { ignoreSearch: true });
        await Promise.all(old.filter(r => r.url !== url.href).map(r => cache.delete(r)));
    }
    await cache.put(key, await plain(res));
}

async function fromCache(request, ignoreSearch) {
    const cache = await caches.open(CACHE);
    return (await cache.match(request)) || (ignoreSearch ? cache.match(request, { ignoreSearch: true }) : undefined);
}

// The network, but give up waiting after NET_WAIT_MS when there's a copy to show instead.
// A slow answer still lands in the copy for next time.
function networkFirst(event, request, key, fallback) {
    const net = fetch(request);
    const saved = net.then(res => {
        if (res.ok) event.waitUntil(store(key, res.clone()).catch(() => {}));
        return res;
    });
    return new Promise(resolve => {
        let done = false;
        const useCopy = async () => {
            const copy = await fallback();
            if (copy && !done) { done = true; offlineUntil = Date.now() + OFFLINE_HOLD_MS; resolve(copy); }
            return copy;
        };
        const timer = setTimeout(useCopy, NET_WAIT_MS);
        saved.then(async res => {
            if (done) return;
            clearTimeout(timer);
            // A gateway or server error page is no better than no signal
            if (res.status >= 500 && await useCopy()) return;
            if (done) return;
            done = true;
            resolve(res);
        }, async () => {
            clearTimeout(timer);
            if (done) return;
            if (!(await useCopy())) { done = true; resolve(Response.error()); }
        });
    });
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (request.mode === 'navigate') {
        // round_tracker, round_tracker.html, any ?query or #hash: one page
        event.respondWith(networkFirst(event, request, PAGE, () => fromCache(PAGE)));
        return;
    }
    if (!keeps(url)) return;
    // The CDN and Google Fonts answer CORS, and a CORS answer (unlike an opaque one) can be kept
    const ask = request.mode === 'no-cors' ? new Request(request.url, { mode: 'cors', credentials: 'omit' }) : request;
    if (Date.now() < offlineUntil) {
        event.respondWith(fromCache(request, true).then(copy => copy || fetch(ask)));
        return;
    }
    event.respondWith(networkFirst(event, ask, request.url, () => fromCache(request, true)));
});

// The page lists what it loaded, so the first visit (before this worker was running) is kept too
self.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type !== 'keep' || !Array.isArray(data.urls)) return;
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.all(data.urls.map(async raw => {
            try {
                const url = new URL(raw, self.location);
                const page = url.origin === self.location.origin && /^\/round_tracker(\.html)?$/.test(url.pathname);
                if (!page && !keeps(url)) return;
                const key = page ? PAGE : url.href;
                if (await cache.match(key)) return;
                const res = await fetch(page ? url.origin + url.pathname : url.href, { mode: url.origin === self.location.origin ? 'same-origin' : 'cors', credentials: 'omit' });
                await store(key, res);
            } catch (e) { /* no signal: the next visit tries again */ }
        }));
    })());
});
