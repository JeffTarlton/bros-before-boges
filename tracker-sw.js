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
// quick: the copy a slow answer may be swapped for; last: the copy for a failed answer (defaults to
// quick). Same-origin files pass an exact-version quick copy, so a slow network right after a deploy
// never pairs a new page with an older script; any older copy still beats no signal at all.
// A page answer that landed after its copy was shown: fetch the files it names first, keep the page
// only once they're all in, and only then drop older versions, so the copy never pairs a page with
// another version's files (and a phone that always opens on a slow signal still catches up)
async function catchUp(res) {
    const cache = await caches.open(CACHE);
    const html = await res.text();
    const refs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g), ...html.matchAll(/<link[^>]+href="([^"]+)"/g)];
    const urls = [...new Set(refs.map(m => new URL(m[1].replace(/&amp;/g, '&'), PAGE).href))]
        .map(h => new URL(h))
        .filter(u => u.origin === self.location.origin && !/^\/round_tracker(\.html)?$/.test(u.pathname));
    for (const u of urls) {
        if (await cache.match(u.href)) continue; // this exact version is already kept
        const r = await fetch(u.href, { mode: 'same-origin', credentials: 'omit' });
        if (!r.ok) throw new Error('missing ' + u.href); // leave the old page and its files as they are
        await cache.put(u.href, await plain(r)); // not store(): nothing older is dropped yet
    }
    // Fresh headers: the original's encoding or length would no longer match the decoded text
    await cache.put(PAGE, new Response(html, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8' } }));
    for (const u of urls) {
        const old = await cache.keys(u.origin + u.pathname, { ignoreSearch: true });
        await Promise.all(old.filter(r => r.url !== u.href).map(r => cache.delete(r)));
    }
}

// page: this is the page itself. Only a page answered from the copy starts the offline hold; a page
// answer that lands after its copy was shown is kept through catchUp, with its files.
function networkFirst(event, request, key, quick, last = quick, page = false) {
    let done = false;
    let usedCopy = false;
    const net = fetch(request);
    const saved = net.then(res => {
        let work = null;
        if (page && usedCopy && res.type === 'opaqueredirect') {
            // /round_tracker.html answers 308 -> /round_tracker (cleanUrls), and most links use the
            // .html address: the browser won't follow it now the copy is showing, so follow it here
            work = fetch(PAGE, { credentials: 'same-origin' }).then(r => (r.ok ? catchUp(r) : undefined));
        } else if (res.ok) {
            work = page && usedCopy ? catchUp(res.clone()) : store(key, res.clone());
        }
        if (work) {
            work = work.catch(() => {});
            try { event.waitUntil(work); } catch (e) { /* the answer was already given: it still finishes */ }
        }
        return res;
    });
    return new Promise(resolve => {
        const useCopy = async get => {
            const copy = await get();
            if (copy && !done) {
                done = true;
                usedCopy = true;
                if (page) offlineUntil = Date.now() + OFFLINE_HOLD_MS;
                resolve(copy);
            }
            return copy;
        };
        const timer = setTimeout(() => useCopy(quick), NET_WAIT_MS);
        saved.then(async res => {
            if (done) return;
            clearTimeout(timer);
            // A gateway or server error page is no better than no signal
            if (res.status >= 500 && await useCopy(last)) return;
            if (done) return;
            done = true;
            // The page came from the network: its files try the network again too
            if (page) offlineUntil = 0;
            resolve(res);
        }, async () => {
            clearTimeout(timer);
            if (done) return;
            if (!(await useCopy(last))) { done = true; resolve(Response.error()); }
        });
    });
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (request.mode === 'navigate') {
        // round_tracker, round_tracker.html, any ?query or #hash: one page
        event.respondWith(networkFirst(event, request, PAGE, () => fromCache(PAGE), undefined, true));
        return;
    }
    if (!keeps(url)) return;
    // The CDN and Google Fonts answer CORS, and a CORS answer (unlike an opaque one) can be kept
    const ask = request.mode === 'no-cors' ? new Request(request.url, { mode: 'cors', credentials: 'omit' }) : request;
    if (Date.now() < offlineUntil) {
        event.respondWith(fromCache(request, true).then(copy => copy || fetch(ask)));
        return;
    }
    const sameOrigin = url.origin === self.location.origin;
    event.respondWith(networkFirst(event, ask, request.url, () => fromCache(request, !sameOrigin), () => fromCache(request, true)));
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
