/* ==========================================================================
   Bros before Boges — phone notifications, the page side
   --------------------------------------------------------------------------
   Loaded after supabase-js and trip-config.js on the homepage, The Bookie, the Round Tracker and
   Admin. The pieces: push_2027.sql (the tables, who gets told what), sw.js (shows the banner and
   opens the app on a tap), api/push.js (sends it). trip-config.js → push.publicKey switches the
   whole thing on; without it every page hides its notification controls.

   window.BBBPush:
     status(client)  → 'on' | 'off' | 'blocked' | 'install' | 'setup' | 'unsupported'
         install:      an iPhone that hasn't added the site to its home screen (Safari only allows
                       notifications in the home-screen app), or a browser that can't do push
         setup:        push_2027.sql hasn't run yet (the save function isn't there)
     enable(client)  from a tap only (the permission prompt needs one): asks, subscribes, saves.
                     Resolves to the new status; never throws (see lastError).
     disable(client) removes this device's subscription. Resolves to the new status.
     refresh(client) once a page knows the login: re-saves an existing subscription at most once a
                     day, so a rotated subscription or a cleared row comes back on its own.
     canInstall() / install()  Android and desktop Chrome: the browser's own install prompt
     installHint()   what to tap to add the app to the home screen, for this phone
   ========================================================================== */
(function () {
    const KEY = window.BBB && window.BBB.push && window.BBB.push.publicKey ? String(window.BBB.push.publicKey) : '';
    const SAVED = 'bbb_push_saved'; // localStorage: when this device last saved its subscription
    const SAVE_EVERY = 24 * 60 * 60 * 1000;
    let lastError = null;
    let installEvent = null;

    function supported() {
        return !!KEY && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function installed() {
        try { if (window.matchMedia('(display-mode: standalone)').matches) return true; } catch (e) { /* no matchMedia */ }
        return navigator.standalone === true;
    }

    function ios() {
        const ua = navigator.userAgent || '';
        return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function phone() {
        return ios() || /Android/.test(navigator.userAgent || '');
    }

    const rpcMissing = err => /PGRST202|could not find the function/i.test(`${err && err.code} ${err && err.message}`);

    // The VAPID public key, as the browser wants it
    function toKey(base64) {
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    // The root worker, active. Registering again when it's already there is a no-op.
    async function activeRegistration() {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (reg.active) return reg;
        const worker = reg.installing || reg.waiting;
        if (worker) {
            await new Promise(resolve => {
                const check = () => {
                    if (worker.state === 'activated' || worker.state === 'redundant') {
                        worker.removeEventListener('statechange', check);
                        resolve();
                    }
                };
                worker.addEventListener('statechange', check);
                check();
            });
        }
        return reg;
    }

    async function currentSubscription() {
        const reg = await navigator.serviceWorker.getRegistration('/');
        return reg ? reg.pushManager.getSubscription() : null;
    }

    // Has push_2027.sql run? Asked once per page (my_push_count is cheap): until it has, every page
    // keeps its notification controls hidden instead of asking for permission it can't use yet.
    let ready = null;
    function backendReady(client) {
        if (!client) return Promise.resolve(true);
        if (!ready) {
            ready = Promise.resolve(client.rpc('my_push_count'))
                .then(res => !(res && res.error && rpcMissing(res.error)))
                .catch(() => true); // offline: decide on the next page
        }
        return ready;
    }

    async function status(client) {
        // An iPhone in a Safari tab has no PushManager at all: the home-screen app does
        const canInstall = !!KEY && ios() && !installed();
        if (!supported() && !canInstall) return 'unsupported';
        if (!(await backendReady(client))) return 'setup';
        if (canInstall) return 'install';
        if (Notification.permission === 'denied') return 'blocked';
        if (Notification.permission !== 'granted') return 'off';
        try {
            return (await currentSubscription()) ? 'on' : 'off';
        } catch (e) {
            return 'off';
        }
    }

    // Saves this device's subscription under the signed-in player. 'on', or 'setup' when the SQL hasn't run.
    async function save(client, sub) {
        const j = sub.toJSON();
        const { error } = await client.rpc('save_push_subscription', {
            p_endpoint: j.endpoint,
            p_p256dh: j.keys && j.keys.p256dh,
            p_auth: j.keys && j.keys.auth,
            p_user_agent: String(navigator.userAgent || '').slice(0, 300)
        });
        if (error) {
            if (rpcMissing(error)) return 'setup';
            throw error;
        }
        try { localStorage.setItem(SAVED, String(Date.now())); } catch (e) { /* private mode */ }
        return 'on';
    }

    async function enable(client) {
        lastError = null;
        // Nothing async before the permission prompt: Safari only shows it inside the tap
        if (ios() && !installed()) return 'install';
        if (!supported()) return 'unsupported';
        if (Notification.permission === 'denied') return 'blocked';
        if (!client) return 'off';
        try {
            let permission = Notification.permission;
            if (permission !== 'granted') permission = await Notification.requestPermission();
            if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
            const reg = await activeRegistration();
            let sub = await reg.pushManager.getSubscription();
            if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(KEY) });
            const saved = await save(client, sub);
            if (saved !== 'on') {
                try { await sub.unsubscribe(); } catch (e) { /* fine */ }
            }
            return saved;
        } catch (err) {
            lastError = err;
            console.warn('Notifications: could not turn on:', err);
            return 'error';
        }
    }

    async function disable(client) {
        lastError = null;
        try {
            const sub = await currentSubscription();
            if (sub) {
                if (client) {
                    try { await client.rpc('delete_push_subscription', { p_endpoint: sub.endpoint }); } catch (e) { /* the sender drops it on the next 410 */ }
                }
                await sub.unsubscribe();
            }
        } catch (err) {
            lastError = err;
            console.warn('Notifications: could not turn off:', err);
        }
        try { localStorage.removeItem(SAVED); } catch (e) { /* fine */ }
        return status();
    }

    async function refresh(client) {
        try {
            if (!client || !supported() || Notification.permission !== 'granted') return;
            const sub = await currentSubscription();
            if (!sub) return;
            let last = 0;
            try { last = Number(localStorage.getItem(SAVED)) || 0; } catch (e) { /* fine */ }
            if (Date.now() - last < SAVE_EVERY) return;
            await save(client, sub);
        } catch (e) { /* the next open tries again */ }
    }

    // Android and desktop Chrome offer an install prompt; keep it for our own button
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        installEvent = e;
    });
    window.addEventListener('appinstalled', () => { installEvent = null; });

    function canInstall() { return !!installEvent && !installed(); }

    async function install() {
        const ev = installEvent;
        if (!ev) return false;
        installEvent = null;
        try {
            ev.prompt();
            const choice = await ev.userChoice;
            return !!choice && choice.outcome === 'accepted';
        } catch (e) {
            return false;
        }
    }

    function installHint() {
        if (ios()) return 'In Safari, tap Share, then Add to Home Screen. Open the app from there to turn on notifications.';
        if (/Android/.test(navigator.userAgent || '')) return 'In Chrome, open the menu and tap Add to Home screen (or Install app).';
        return 'Add the site to your home screen or install it from the browser menu, then turn on notifications from there.';
    }

    window.BBBPush = {
        supported, installed, ios, phone, status, enable, disable, refresh, canInstall, install, installHint,
        get lastError() { return lastError; }
    };
})();
