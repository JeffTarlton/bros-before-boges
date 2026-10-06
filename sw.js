// Phone notifications for the home-screen app (push_2027.sql, push.js, api/push.js).
//
// Registered by push.js at scope "/" once a player turns notifications on. It only shows the
// notification a push carries and opens the app when one is tapped. There is no fetch handler,
// so it never touches caching: every page loads exactly as it does without it. The Round
// Tracker's own worker (tracker-sw.js, scope /round_tracker) keeps that page's offline copy,
// side by side with this one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// What api/push.js sends: { title, body, url, tag, kind }
self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { body: event.data ? event.data.text() : '' };
    }
    const title = data.title || 'Bros before Boges';
    const options = {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        data: { url: data.url || '/' }
    };
    // Same tag: the newer banner replaces the older one (four tee-time saves make one banner)
    if (data.tag) options.tag = String(data.tag);
    event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping it opens the page it's about: in the app window that's already open when there is one
self.addEventListener('notificationclick', event => {
    event.notification.close();
    // Only ever a page on this site: anything that resolves elsewhere ("//other.site") opens the homepage
    let url = self.location.origin + '/';
    try {
        const to = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
        if (to.origin === self.location.origin) url = to.href;
    } catch (e) { /* the homepage */ }
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const path = new URL(url).pathname.replace(/\.html$/, '');
        const samePage = windows.find(c => {
            try { return new URL(c.url).pathname.replace(/\.html$/, '') === path; } catch (e) { return false; }
        });
        const client = samePage || windows[0];
        if (client) {
            try {
                await client.focus();
                if (typeof client.navigate === 'function') {
                    await client.navigate(url);
                    return;
                }
            } catch (e) { /* a new window instead */ }
        }
        await self.clients.openWindow(url);
    })());
});

// The browser swapped the subscription for a new one: subscribe again with the same key, and the
// page saves the new one on its next open (push.js refresh()).
self.addEventListener('pushsubscriptionchange', event => {
    event.waitUntil((async () => {
        try {
            const old = event.oldSubscription;
            const key = old && old.options && old.options.applicationServerKey;
            if (key) await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        } catch (e) { /* the next visit subscribes again */ }
    })());
});
