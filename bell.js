/* ==========================================================================
   Bros before Boges — the notification bell (bell_2027.sql, push.js)
   --------------------------------------------------------------------------
   A bell in the top-right corner of every signed-in page, for approved players. Its count is how
   many notifications are new; tapping it opens the list (newest first), plus the switch that turns
   notifications on or off for this phone and a "Send a test" button. The list works with or
   without a phone turned on: every approved player gets every notification here.

   A page mounts it once it has its Supabase client:
     BBBBell.mount({ client, place: el => header.insertBefore(el, menuButton) })
   It hides itself when nobody's signed in, for a sign-up waiting for approval, and until
   bell_2027.sql has run. A dropped signal doesn't hide it: only a clear answer does. Everything
   shown is text (textContent), never HTML, and a notification can only open a page on this site.
   ========================================================================== */
(function () {
    const CHECK_EVERY = 60000;
    const PAGE = 30;
    let client = null;
    let button = null;
    let badge = null;
    let panel = null;
    let els = {};
    let ready = false;        // signed in as crew and the bell's SQL is there
    let unread = 0;
    let items = [];
    let more = false;
    let timer = null;
    let checking = null;
    let checkAgain = false;
    let markSeq = 0;          // bumped whenever this page marks notifications seen
    let busy = false;
    let phoneState = '';

    const BELL_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

    function node(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = String(text);
        return n;
    }

    // Only ever a page on this site. A path the browser would read as another site ("//x", "/\x",
    // what "/.//x" collapses to) opens the homepage instead.
    function safeHref(url) {
        try {
            const to = new URL(url || '/', location.origin);
            const path = to.pathname + to.search + to.hash;
            return to.origin === location.origin && !/^\/[\/\\]/.test(path) ? path : '/';
        } catch (e) {
            return '/';
        }
    }

    function when(iso) {
        const d = new Date(iso);
        const ms = Date.now() - d.getTime();
        if (Number.isNaN(ms)) return '';
        if (ms < 60000) return 'now';
        if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return `${Math.floor(ms / 3600000)}h`;
        const yest = new Date(today); yest.setDate(today.getDate() - 1);
        if (d.toDateString() === yest.toDateString()) return 'Yesterday';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // A clear "no": no such function yet (the SQL hasn't run) or not allowed. Anything else (no
    // signal, a server hiccup) is a "couldn't ask", which leaves the bell as it is.
    const definiteNo = error => /PGRST202|could not find the function|42501|28000|permission denied/i.test(`${error && error.code} ${error && error.message}`);

    // ---- the button and its count --------------------------------------------------------------
    function build() {
        button = node('button', 'bbb-bell');
        button.type = 'button';
        button.hidden = true;
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'bbb-bell-panel');
        button.innerHTML = BELL_SVG;
        badge = node('span', 'bbb-bell-badge');
        badge.hidden = true;
        badge.setAttribute('aria-hidden', 'true');
        button.appendChild(badge);
        button.addEventListener('click', () => (panel.hidden ? open() : close()));

        // The panel lives at the end of <body> (headers with a blur would trap a fixed panel inside
        // them); as a modal dialog it keeps keyboard focus inside itself until it closes.
        panel = node('div', 'bbb-bell-panel');
        panel.id = 'bbb-bell-panel';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'bbb-bell-title');
        const head = node('div', 'bbb-bell-head');
        const title = node('h2', 'bbb-bell-title', 'Notifications');
        title.id = 'bbb-bell-title';
        title.tabIndex = -1;
        const x = node('button', 'bbb-bell-close', '×');
        x.type = 'button';
        x.setAttribute('aria-label', 'Close notifications');
        x.addEventListener('click', () => close());
        head.append(title, x);

        const phone = node('div', 'bbb-bell-phone');
        const phoneText = node('p', 'bbb-bell-phone-text');
        const phoneActions = node('div', 'bbb-bell-actions');
        const toggle = node('button', 'bbb-bell-btn');
        toggle.type = 'button';
        toggle.hidden = true;
        toggle.addEventListener('click', onToggle);
        const test = node('button', 'bbb-bell-btn is-quiet', 'Send a test');
        test.type = 'button';
        test.addEventListener('click', onTest);
        phoneActions.append(toggle, test);
        const status = node('p', 'bbb-bell-status');
        status.setAttribute('role', 'status');
        phone.append(phoneText, phoneActions, status);

        const list = node('ul', 'bbb-bell-list');
        list.setAttribute('aria-label', 'Your notifications');
        const moreBtn = node('button', 'bbb-bell-more', 'Show older');
        moreBtn.type = 'button';
        moreBtn.hidden = true;
        moreBtn.addEventListener('click', loadOlder);

        panel.append(head, phone, list, moreBtn);
        document.body.appendChild(panel);
        els = { title, close: x, phoneText, toggle, test, status, list, moreBtn };

        panel.addEventListener('keydown', trapTab);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
        // A press anywhere else closes it (pointerdown: iOS doesn't send click for taps on plain areas)
        document.addEventListener('pointerdown', e => {
            if (panel.hidden) return;
            if (panel.contains(e.target) || button.contains(e.target)) return;
            close(false);
        }, true);
        window.addEventListener('resize', () => { fit(); if (!panel.hidden) position(); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(() => {});
        // On a page whose header scrolls away (Admin), the panel follows the bell, and closes once
        // the bell is out of sight
        window.addEventListener('scroll', () => {
            if (panel.hidden) return;
            const r = button.getBoundingClientRect();
            if (r.bottom < 0) close(false);
            else position();
        }, { passive: true });
    }

    function focusables() {
        return [...panel.querySelectorAll('button, a[href]')].filter(el => !el.hidden && !el.disabled && el.getClientRects().length);
    }

    function trapTab(e) {
        if (e.key !== 'Tab') return;
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === els.title)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function setUnread(n) {
        // While the list is open, what's in it is being seen: no count
        unread = panel && !panel.hidden ? 0 : Math.max(0, Number(n) || 0);
        badge.textContent = unread > 9 ? '9+' : String(unread);
        badge.hidden = !unread;
        button.setAttribute('aria-label', unread ? `Notifications, ${unread} new` : 'Notifications');
        button.classList.toggle('has-new', unread > 0);
    }

    // Signed in as crew, with the bell's SQL there? Then show the bell with its count.
    async function check() {
        if (!client) return;
        if (checking) { checkAgain = true; return checking; }
        checking = (async () => {
            const seq = markSeq;
            let show = ready;
            let n = unread;
            try {
                const { data: { session } } = await client.auth.getSession();
                if (!session) {
                    show = false; n = 0;
                } else {
                    const { data, error } = await client.rpc('my_notification_summary');
                    if (error) {
                        if (definiteNo(error)) { show = false; n = 0; }
                        // otherwise: couldn't ask, keep what's showing
                    } else {
                        show = !!(data && data.crew);
                        n = show ? data.unread : 0;
                    }
                }
            } catch (e) { /* offline: keep what's showing */ }
            ready = show;
            button.hidden = !show;
            fit();
            if (!show && !panel.hidden) close(false);
            // Seen something since this check started? Its count is out of date: keep ours
            if (seq === markSeq) setUnread(show ? n : 0);
        })();
        try { await checking; } finally {
            checking = null;
            if (checkAgain) { checkAgain = false; check(); }
        }
    }

    // Does the bell fit in its header? If it would hang off the edge (the homepage's full desktop row on a
    // trip day at 1100-1280px), the header gets .bell-tight and folds its links into the menu button
    function fit() {
        const parent = button && button.parentElement;
        if (!parent) return;
        parent.classList.remove('bell-tight');
        if (button.hidden) return;
        const r = button.getBoundingClientRect();
        if (r.right > window.innerWidth - 2 || r.left < 0) parent.classList.add('bell-tight');
    }

    function schedule() {
        clearTimeout(timer);
        if (document.hidden) return;
        timer = setTimeout(async () => { await check(); schedule(); }, CHECK_EVERY);
    }

    // ---- the panel -----------------------------------------------------------------------------
    function position() {
        const r = button.getBoundingClientRect();
        const narrow = window.innerWidth < 520;
        panel.style.top = `${Math.round(Math.max(8, r.bottom + 8))}px`;
        if (narrow) {
            panel.style.left = '8px';
            panel.style.right = '8px';
        } else {
            panel.style.left = 'auto';
            panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
        }
    }

    async function open() {
        if (!ready || !panel.hidden) return;
        position();
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        setUnread(0);
        els.title.focus({ preventScroll: true });
        els.status.textContent = '';
        renderPhone();
        if (await loadList() && !panel.hidden) markShown();
    }

    function close(returnFocus = true) {
        if (panel.hidden) return;
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        if (returnFocus) button.focus({ preventScroll: true });
        // What's still new (if marking failed) shows up again on the next check
        check();
    }

    // Mark what's actually on screen and new as seen (never anything not shown)
    async function markShown() {
        const ids = items.filter(n => !n.read_at).map(n => n.id);
        if (!ids.length) return;
        markSeq++;
        try {
            const { error } = await client.rpc('mark_notifications_read', { p_ids: ids });
            if (!error) {
                const at = new Date().toISOString();
                items.forEach(n => { if (ids.includes(n.id)) n.seenNow = true; if (ids.includes(n.id) && !n.read_at) n.read_at = at; });
            }
        } catch (e) { /* stays new; the next check shows it */ }
    }

    async function fetchPage(before) {
        const args = { p_limit: PAGE, p_before: before ? before.created_at : null, p_before_id: before ? before.id : null };
        const { data, error } = await client.rpc('my_notifications', args);
        if (error) return null;
        return { list: Array.isArray(data && data.items) ? data.items : [], more: !!(data && data.more) };
    }

    // The newest page, replacing what's shown. true when it loaded.
    async function loadList() {
        els.list.textContent = '';
        els.list.appendChild(node('li', 'bbb-bell-empty', 'Loading…'));
        const page = await fetchPage(null);
        if (!page) {
            els.list.textContent = '';
            els.list.appendChild(node('li', 'bbb-bell-empty', 'Couldn’t load your notifications. Check your signal and try again.'));
            return false;
        }
        items = page.list.map(n => Object.assign(n, { seenNow: !n.read_at }));
        more = page.more;
        renderList();
        return true;
    }

    // New ones arrived while the list is open: add them at the top, keeping older pages, scroll and focus
    async function mergeNewest() {
        const page = await fetchPage(null);
        if (!page || panel.hidden) return;
        const have = new Set(items.map(n => n.id));
        const fresh = page.list.filter(n => !have.has(n.id)).map(n => Object.assign(n, { seenNow: !n.read_at }));
        if (!fresh.length) return;
        items = fresh.concat(items);
        const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
        const top = els.list.scrollTop;
        renderList();
        els.list.scrollTop = top;
        if (focusedId) { const again = els.list.querySelector(`a[data-id="${CSS.escape(focusedId)}"]`); if (again) again.focus({ preventScroll: true }); }
        markShown();
    }

    async function loadOlder() {
        if (!items.length) return;
        els.moreBtn.disabled = true;
        const page = await fetchPage(items[items.length - 1]);
        els.moreBtn.disabled = false;
        if (!page) return;
        const have = new Set(items.map(n => n.id));
        const older = page.list.filter(n => !have.has(n.id)).map(n => Object.assign(n, { seenNow: !n.read_at }));
        items = items.concat(older);
        more = page.more;
        renderList();
        markShown();
    }

    function renderList() {
        els.list.textContent = '';
        if (!items.length) {
            els.list.appendChild(node('li', 'bbb-bell-empty', 'Nothing yet. Challenges, results, tee times and the commissioner’s updates show up here.'));
        }
        items.forEach(n => {
            // "New" stays on what was new when it came into view, for as long as the panel's open
            const li = node('li', `bbb-bell-item${n.seenNow ? ' is-new' : ''}`);
            const a = node('a', 'bbb-bell-link');
            a.href = safeHref(n.url);
            a.dataset.id = n.id;
            const top = node('span', 'bbb-bell-row');
            top.append(node('span', 'bbb-bell-item-title', n.title), node('span', 'bbb-bell-when', when(n.created_at)));
            a.appendChild(top);
            if (n.body) a.appendChild(node('span', 'bbb-bell-body', n.body));
            if (n.seenNow) a.appendChild(node('span', 'bbb-sr', ' (new)'));
            a.addEventListener('click', () => close(false));
            li.appendChild(a);
            els.list.appendChild(li);
        });
        els.moreBtn.hidden = !more;
    }

    // ---- this phone: on/off, and a test ---------------------------------------------------------
    async function renderPhone() {
        const P = window.BBBPush;
        const t = els.toggle;
        if (!P) {
            phoneState = 'unsupported';
            els.phoneText.textContent = 'This browser can’t show notifications. They still show up here.';
            t.hidden = true;
            return;
        }
        // Until this phone's state is known there's nothing to press
        t.hidden = true;
        delete t.dataset.state;
        if (!phoneState) els.phoneText.textContent = 'Checking this phone…';
        const state = await P.status(client);
        phoneState = state;
        t.dataset.state = state;
        t.disabled = false;
        t.hidden = false;
        if (state === 'on') {
            els.phoneText.textContent = 'Notifications are on for this phone.';
            t.textContent = 'Turn off';
            t.classList.add('is-quiet');
        } else if (state === 'off') {
            els.phoneText.textContent = 'Notifications are off for this phone. Turn them on to get challenges, results and updates as they happen.';
            t.textContent = 'Turn on';
            t.classList.remove('is-quiet');
        } else if (state === 'install') {
            const can = P.canInstall();
            els.phoneText.textContent = can ? 'Install the app to get notifications on this phone.' : P.installHint();
            t.textContent = 'Install';
            t.classList.remove('is-quiet');
            t.hidden = !can;
        } else if (state === 'blocked') {
            els.phoneText.textContent = 'Notifications are blocked for this site. Allow them in your phone’s Settings, then come back here.';
            t.hidden = true;
        } else {
            els.phoneText.textContent = 'This browser can’t show notifications. They still show up here.';
            t.hidden = true;
        }
    }

    async function onToggle() {
        const P = window.BBBPush;
        const state = els.toggle.dataset.state;
        if (!P || busy || !['on', 'off', 'install'].includes(state)) return;
        busy = true;
        els.toggle.disabled = true;
        els.status.textContent = '';
        try {
            if (state === 'on') {
                await P.disable(client);
                els.status.textContent = 'Notifications are off on this phone. You’ll still see them here.';
            } else if (state === 'install') {
                await P.install();
            } else {
                const r = await P.enable(client);
                if (r === 'on') els.status.textContent = 'Notifications are on. Try Send a test.';
                else if (r === 'blocked') els.status.textContent = 'Notifications are blocked for this site. Allow them in your phone’s Settings.';
                else if (r === 'install') els.status.textContent = P.installHint();
                else if (r === 'error') els.status.textContent = `Couldn’t turn on notifications: ${(P.lastError && P.lastError.message) || 'try again'}`;
            }
        } finally {
            busy = false;
            await renderPhone();
            // The homepage checklist (and anything else showing this phone's state) catches up
            window.dispatchEvent(new CustomEvent('bbb-push-change', { detail: { state: phoneState, fromBell: true } }));
        }
    }

    function testMessage(devices) {
        const here = phoneState;
        if (here === 'on') {
            return devices > 1
                ? `Test sent to your ${devices} phones. It should pop up on this one in a few seconds.`
                : 'Test sent. It should pop up on this phone in a few seconds.';
        }
        const others = devices ? `Sent to your other ${devices === 1 ? 'phone' : `${devices} phones`}, and it’s in the list below. ` : 'Test sent. It’s in the list below. ';
        if (here === 'off') return `${others}To get it on this phone too, tap Turn on.`;
        if (here === 'blocked') return `${others}This phone has notifications blocked: allow them in its Settings.`;
        if (here === 'install' && window.BBBPush) return `${others}${window.BBBPush.installHint()}`;
        return `${others}This browser can’t show notifications.`;
    }

    async function onTest() {
        if (busy) return;
        busy = true;
        els.test.disabled = true;
        els.status.textContent = 'Sending…';
        try {
            const { data, error } = await client.rpc('send_me_test_notification');
            if (error) {
                els.status.textContent = /PGRST202|could not find/i.test(`${error.code} ${error.message}`)
                    ? 'Notifications are being set up. Check back soon.'
                    : String(error.message || 'Couldn’t send a test. Try again.');
                return;
            }
            els.status.textContent = testMessage(Number(data && data.devices) || 0);
            setTimeout(() => { if (!panel.hidden) mergeNewest(); }, 800);
        } catch (e) {
            els.status.textContent = 'Couldn’t send a test. Check your signal and try again.';
        } finally {
            busy = false;
            els.test.disabled = false;
        }
    }

    // ---- start ---------------------------------------------------------------------------------
    function mount(opts) {
        if (button || !opts || !opts.client || typeof opts.place !== 'function') return;
        client = opts.client;
        build();
        try { opts.place(button); } catch (e) { document.body.appendChild(button); }
        check();
        schedule();
        try { client.auth.onAuthStateChange(() => { setTimeout(check, 0); }); } catch (e) { /* no auth events: the timer checks */ }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { clearTimeout(timer); return; }
            check();
            schedule();
        });
        // A notification arrived while the page is open (sw.js tells the page): update the count,
        // or the open list
        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', e => {
                if (!e.data || e.data.type !== 'bbb-push') return;
                if (!panel.hidden) mergeNewest();
                else check();
            });
        }
        // This phone turned on or off somewhere else on the page (the homepage checklist)
        window.addEventListener('bbb-push-change', e => {
            if (!panel.hidden && !(e.detail && e.detail.fromBell)) renderPhone();
        });
    }

    window.BBBBell = { mount, refresh: check, open: () => open(), close: () => close() };
})();
