/* ==========================================================================
   Bros before Boges — Messages (messages.html, messages_2027.sql)
   --------------------------------------------------------------------------
   Player-to-player messages. Everything goes through the database's message functions, which work
   out who's asking from the login itself: this page never says who the sender is, and can only
   ever read the signed-in player's own conversations.

   Safety: every name, preview and message is put on the page as text (textContent), never as HTML,
   so nothing anyone types can run here. The ?with= address is only used when it's a player id.
   No realtime feed: the open conversation is re-read every 10 seconds while the page shows (and
   right away when it comes back to the front); a new message also arrives as a notification.
   ========================================================================== */
(function () {
    const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';
    // A player id from the address (?with=): letters, digits and dashes only, like The Bookie's bet links.
    // It only ever goes to the database as a value (which insists on a real id) and back into this page's own address.
    const UUID = /^[\w-]{1,64}$/;
    const THREAD_EVERY = 10000;
    const LIST_EVERY = 30000;
    const LOGIN_URL = 'bookie.html?next=messages&mode=login';

    const $ = id => document.getElementById(id);
    const el = {
        gate: $('msg-gate'), gateTitle: $('gate-title'), gateText: $('gate-text'), gateAction: $('gate-action'),
        layout: $('msg-layout'), list: $('conv-list'), newBtn: $('msg-new'),
        push: $('msg-push'), pushText: $('msg-push-text'), pushBtn: $('msg-push-btn'),
        back: $('thread-back'), title: $('thread-title'), scroll: $('thread-scroll'), empty: $('thread-empty'),
        composer: $('composer'), text: $('composer-text'), send: $('composer-send'), note: $('composer-note'),
        pick: $('pick'), pickClose: $('pick-close'), pickFilter: $('pick-filter'), pickList: $('pick-list')
    };

    let sb = null;
    let contacts = [];
    let convs = [];
    let current = null;               // the open conversation's player id
    let thread = null;                // { with: { id, name, reachable }, messages: [], more }
    let sending = false;
    let threadTimer = null;
    let listTimer = null;
    let lastFocus = null;

    // ---- small helpers -----------------------------------------------------------------------
    const rpcMissing = err => /PGRST202|could not find the function/i.test(`${err && err.code} ${err && err.message}`);
    const isNetwork = err => /failed to fetch|load failed|networkerror|network request failed/i.test(String((err && err.message) || err || ''));
    const plain = err => isNetwork(err) ? 'No signal. Try again in a moment.' : String((err && err.message) || err || 'Something went wrong.');
    const firstName = name => String(name || '').trim().split(/\s+/)[0] || 'them';

    function node(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = String(text);
        return n;
    }

    function dayKey(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
    function dayLabel(d) {
        const today = new Date();
        const yest = new Date(today); yest.setDate(today.getDate() - 1);
        if (dayKey(d) === dayKey(today)) return 'Today';
        if (dayKey(d) === dayKey(yest)) return 'Yesterday';
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    const clock = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    function shortWhen(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return dayKey(d) === dayKey(new Date()) ? clock(d) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function measureHeader() {
        const header = document.querySelector('.site-header');
        if (header) document.documentElement.style.setProperty('--hdr', `${header.offsetHeight}px`);
    }

    // ---- the card shown instead of the app -------------------------------------------------------
    function gate(title, text, action) {
        el.layout.hidden = true;
        el.gate.hidden = false;
        el.gateTitle.textContent = title;
        el.gateText.textContent = text;
        if (action) {
            el.gateAction.textContent = action.label;
            el.gateAction.href = action.href;
            el.gateAction.hidden = false;
        } else {
            el.gateAction.hidden = true;
        }
    }

    function gateFor(err) {
        if (rpcMissing(err)) return gate('Messages', 'Messages are being set up. Check back soon.');
        const code = err && err.code;
        if (code === '28000') return gate('Messages', 'Log in to message the crew.', { label: 'Log in', href: LOGIN_URL });
        if (code === 'P0002') return gate('Messages', 'Your login isn’t linked to a player yet. Pick your name in The Bookie, then come back.', { label: 'Open The Bookie', href: 'bookie.html?next=messages' });
        if (code === '42501') return gate('Messages', 'Messages open once the commissioner approves you. You’ll get them here as soon as you’re on the roster.', { label: 'Back home', href: 'index.html' });
        return gate('Messages', `Couldn’t load your messages. ${plain(err)}`, { label: 'Try again', href: location.href });
    }

    // ---- conversations -------------------------------------------------------------------------
    async function loadConversations() {
        const { data, error } = await sb.rpc('my_conversations');
        if (error) throw error;
        convs = Array.isArray(data) ? data : [];
        renderConversations();
    }

    function renderConversations() {
        el.list.textContent = '';
        if (!convs.length) {
            el.list.appendChild(node('li', 'conv-empty', 'No messages yet. Tap New message to start one.'));
            return;
        }
        convs.forEach(c => {
            const li = node('li', `conv-item${c.unread > 0 ? ' is-unread' : ''}`);
            const b = node('button');
            b.type = 'button';
            b.dataset.player = c.player_id;
            if (c.player_id === current) b.setAttribute('aria-current', 'true');
            const name = node('span', 'conv-name', c.name);
            if (c.unread > 0) {
                const badge = node('span', 'conv-badge', c.unread > 99 ? '99+' : c.unread);
                badge.setAttribute('aria-label', `${c.unread} unread`);
                name.appendChild(badge);
            }
            b.append(name, node('span', 'conv-time', shortWhen(c.last_at)),
                node('span', 'conv-preview', `${c.last_from_me ? 'You: ' : ''}${String(c.last_body || '').replace(/\s+/g, ' ')}`));
            b.addEventListener('click', () => openThread(c.player_id, { push: true }));
            li.appendChild(b);
            el.list.appendChild(li);
        });
    }

    // ---- one conversation ----------------------------------------------------------------------
    async function openThread(playerId, { push = false } = {}) {
        if (!UUID.test(String(playerId || ''))) return;
        const same = current === playerId;
        current = playerId;
        el.layout.dataset.view = 'thread';
        const url = `messages.html?with=${encodeURIComponent(playerId)}`;
        // pushed: opened from the list on this page, so Back steps back to it. Arriving from a
        // notification or a link isn't, and Back shows the list instead of leaving the page.
        try {
            if (push && !same) history.pushState({ with: playerId, pushed: true }, '', url);
            else history.replaceState({ with: playerId, pushed: !!(history.state && history.state.pushed) }, '', url);
        } catch (e) { /* sandboxed: the page still works */ }
        if (!same) {
            thread = null;
            const known = convs.find(c => c.player_id === playerId) || contacts.find(c => c.id === playerId);
            el.title.textContent = known ? known.name : 'Messages';
            el.scroll.textContent = '';
            el.scroll.appendChild(node('p', 'thread-empty', 'Loading…'));
            el.composer.hidden = true;
            setNote('');
            el.text.value = draftFor(playerId);
            autosize();
        }
        renderConversations();
        await refreshThread({ scroll: 'bottom' });
        if (!window.matchMedia('(pointer: coarse)').matches && !el.composer.hidden) el.text.focus({ preventScroll: true });
        scheduleThread();
    }

    function closeThread() {
        current = null;
        thread = null;
        el.layout.dataset.view = 'list';
        el.title.textContent = 'Pick a conversation';
        el.scroll.textContent = '';
        el.scroll.appendChild(el.empty);
        el.composer.hidden = true;
        setNote('');
        try { history.replaceState(null, '', 'messages.html'); } catch (e) { /* fine */ }
        renderConversations();
    }

    async function refreshThread({ scroll } = {}) {
        if (!current) return;
        const want = current;
        const { data, error } = await sb.rpc('my_messages', { p_with: want, p_before: null, p_limit: 50 });
        if (want !== current) return; // switched while it loaded
        if (error) {
            if (!thread) {
                el.scroll.textContent = '';
                el.scroll.appendChild(node('p', 'thread-empty', error.code === 'P0002' ? 'That player isn’t on the roster.' : `Couldn’t load this conversation. ${plain(error)}`));
            }
            return;
        }
        const nearBottom = el.scroll.scrollHeight - el.scroll.scrollTop - el.scroll.clientHeight < 80;
        // Keep older pages already loaded, and anything still sending
        const older = thread && thread.with.id === want ? thread.messages.filter(m => !data.messages.some(n => n.id === m.id) && data.messages.length && m.created_at < data.messages[0].created_at) : [];
        const pending = thread && thread.with.id === want ? thread.messages.filter(m => m.pending) : [];
        thread = { with: data.with, messages: older.concat(data.messages, pending), more: older.length ? thread.more : data.more };
        renderThread();
        if (scroll === 'bottom' || nearBottom) el.scroll.scrollTop = el.scroll.scrollHeight;
        // What he sent is read now
        if (data.messages.some(m => !m.from_me && !m.read_at)) {
            sb.rpc('mark_messages_read', { p_with: want }).then(() => loadConversations().catch(() => {}));
        }
    }

    async function loadOlder() {
        if (!thread || !thread.more || !thread.messages.length) return;
        const want = current;
        const before = thread.messages.find(m => !m.pending).created_at;
        const { data, error } = await sb.rpc('my_messages', { p_with: want, p_before: before, p_limit: 50 });
        if (error || want !== current) return;
        const h = el.scroll.scrollHeight;
        thread.messages = data.messages.concat(thread.messages);
        thread.more = data.more;
        renderThread();
        el.scroll.scrollTop = el.scroll.scrollHeight - h;
    }

    function renderThread() {
        if (!thread) return;
        el.title.textContent = thread.with.name;
        el.scroll.textContent = '';
        if (thread.more) {
            const more = node('button', 'thread-more', 'Show earlier messages');
            more.type = 'button';
            more.addEventListener('click', loadOlder);
            el.scroll.appendChild(more);
        }
        if (!thread.messages.length) {
            el.scroll.appendChild(node('p', 'thread-empty', `No messages with ${firstName(thread.with.name)} yet. Say hello.`));
        }
        // "Seen" goes under the newest message of mine he's read
        const mine = thread.messages.filter(m => m.from_me && !m.pending);
        const lastMine = mine[mine.length - 1];
        let lastDay = '';
        thread.messages.forEach(m => {
            const d = new Date(m.created_at);
            const key = dayKey(d);
            if (key !== lastDay) {
                el.scroll.appendChild(node('p', 'day-sep', dayLabel(d)));
                lastDay = key;
            }
            const wrap = node('div', `bubble ${m.from_me ? 'mine' : 'theirs'}${m.pending ? ' is-pending' : ''}`);
            wrap.appendChild(node('p', 'bubble-text', m.body));
            const meta = node('div', 'bubble-meta');
            meta.appendChild(node('span', null, m.pending ? 'Sending…' : clock(d)));
            if (m.from_me && !m.pending && m === lastMine && m.read_at) meta.appendChild(node('span', null, '· Seen'));
            if (m.from_me && !m.pending) {
                const del = node('button', null, 'Unsend');
                del.type = 'button';
                del.setAttribute('aria-label', 'Unsend this message');
                del.addEventListener('click', () => unsend(m));
                meta.appendChild(del);
            }
            wrap.appendChild(meta);
            el.scroll.appendChild(wrap);
        });
        const reachable = thread.with.reachable !== false;
        el.composer.hidden = !reachable;
        if (!reachable) setNote(`${firstName(thread.with.name)} can’t get messages right now (no login yet, or waiting for the commissioner).`);
        else if (el.note.dataset.kind === 'reach') setNote('');
        if (!reachable) el.note.dataset.kind = 'reach';
    }

    // ---- sending -------------------------------------------------------------------------------
    function setNote(text, isError) {
        el.note.textContent = text || '';
        el.note.classList.toggle('is-error', !!isError);
        delete el.note.dataset.kind;
    }

    async function send() {
        if (sending || !current || !thread) return;
        const body = el.text.value.replace(/\r\n/g, '\n').trim();
        if (!body) return;
        if (body.length > 1000) { setNote('Keep it to 1,000 characters.', true); return; }
        sending = true;
        el.send.disabled = true;
        setNote('');
        const to = current;
        const temp = { id: `pending-${Date.now()}`, from_me: true, body, created_at: new Date().toISOString(), read_at: null, pending: true };
        thread.messages.push(temp);
        renderThread();
        el.scroll.scrollTop = el.scroll.scrollHeight;
        const { data, error } = await sb.rpc('send_message', { p_to: to, p_body: body });
        sending = false;
        el.send.disabled = false;
        if (to !== current || !thread) return;
        thread.messages = thread.messages.filter(m => m !== temp);
        if (error) {
            renderThread();
            setNote(error.code === '54000' ? plain(error) : `Didn’t send: ${plain(error)}`, true);
            return; // the text stays in the box to try again
        }
        el.text.value = '';
        saveDraft(to, '');
        autosize();
        if (!thread.messages.some(m => m.id === data.id)) thread.messages.push(data);
        renderThread();
        el.scroll.scrollTop = el.scroll.scrollHeight;
        loadConversations().catch(() => {});
    }

    async function unsend(m) {
        if (!window.confirm('Unsend this message? It disappears for both of you.')) return;
        const { data, error } = await sb.rpc('delete_message', { p_id: m.id });
        if (error) { setNote(`Couldn’t unsend: ${plain(error)}`, true); return; }
        if (data && thread) {
            thread.messages = thread.messages.filter(x => x.id !== m.id);
            renderThread();
            loadConversations().catch(() => {});
        }
    }

    // Unsent text survives switching conversations and reloads (this phone only)
    function draftFor(id) { try { return sessionStorage.getItem(`bbb_dm_draft_${id}`) || ''; } catch (e) { return ''; } }
    function saveDraft(id, text) {
        try { if (text) sessionStorage.setItem(`bbb_dm_draft_${id}`, text); else sessionStorage.removeItem(`bbb_dm_draft_${id}`); } catch (e) { /* private mode */ }
    }

    function autosize() {
        el.text.style.height = 'auto';
        el.text.style.height = `${Math.min(el.text.scrollHeight, 160)}px`;
    }

    // ---- new message ---------------------------------------------------------------------------
    function renderPick() {
        const q = el.pickFilter.value.trim().toLowerCase();
        el.pickList.textContent = '';
        const list = contacts.filter(c => !q || c.name.toLowerCase().includes(q));
        if (!list.length) {
            el.pickList.appendChild(node('li', 'conv-empty', contacts.length ? 'No one by that name.' : 'Nobody else can get messages yet.'));
            return;
        }
        list.forEach(c => {
            const li = node('li');
            const b = node('button', null, c.name);
            b.type = 'button';
            b.addEventListener('click', () => { closePick(); openThread(c.id, { push: true }); });
            li.appendChild(b);
            el.pickList.appendChild(li);
        });
    }
    function openPick() {
        lastFocus = document.activeElement;
        el.pick.hidden = false;
        el.pickFilter.value = '';
        renderPick();
        el.pickFilter.focus();
    }
    function closePick() {
        el.pick.hidden = true;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    // ---- notifications prompt ------------------------------------------------------------------
    async function renderPush() {
        const P = window.BBBPush;
        if (!P) return;
        const state = await P.status(sb);
        if (state === 'off') {
            el.pushText.textContent = 'Turn on notifications to hear about new messages on this phone.';
            el.pushBtn.textContent = 'Turn on';
            el.pushBtn.parentElement.hidden = false;
            el.push.hidden = false;
        } else if (state === 'install') {
            el.pushText.textContent = P.canInstall() ? 'Install the app to get notified about new messages.' : P.installHint();
            el.pushBtn.textContent = 'Install';
            el.pushBtn.parentElement.hidden = !P.canInstall();
            el.push.hidden = false;
        } else {
            el.push.hidden = true;
        }
        if (state === 'on') P.refresh(sb);
    }
    async function pushTap() {
        const P = window.BBBPush;
        if (!P) return;
        el.pushBtn.disabled = true;
        try {
            if (P.canInstall()) await P.install();
            else {
                const r = await P.enable(sb);
                if (r === 'blocked') el.pushText.textContent = 'Notifications are blocked for this site. Allow them in your phone’s Settings.';
                if (r === 'error') el.pushText.textContent = `Couldn’t turn on notifications: ${(P.lastError && P.lastError.message) || 'try again'}`;
                if (r === 'blocked' || r === 'error') { el.pushBtn.parentElement.hidden = true; return; }
            }
        } finally {
            el.pushBtn.disabled = false;
        }
        renderPush();
    }

    // ---- refreshing ----------------------------------------------------------------------------
    function scheduleThread() {
        clearTimeout(threadTimer);
        if (!current || document.hidden) return;
        threadTimer = setTimeout(async () => { await refreshThread().catch(() => {}); scheduleThread(); }, THREAD_EVERY);
    }
    function scheduleList() {
        clearTimeout(listTimer);
        if (document.hidden) return;
        listTimer = setTimeout(async () => { await loadConversations().catch(() => {}); scheduleList(); }, LIST_EVERY);
    }

    // ---- start ---------------------------------------------------------------------------------
    function wire() {
        el.newBtn.addEventListener('click', openPick);
        el.pickClose.addEventListener('click', closePick);
        el.pick.addEventListener('click', e => { if (e.target === el.pick) closePick(); });
        el.pickFilter.addEventListener('input', renderPick);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.pick.hidden) closePick(); });
        el.back.addEventListener('click', () => {
            if (history.state && history.state.pushed) history.back();
            else closeThread();
        });
        window.addEventListener('popstate', () => {
            const id = new URLSearchParams(location.search).get('with');
            if (id && UUID.test(id)) openThread(id);
            else closeThread();
        });
        el.composer.addEventListener('submit', e => { e.preventDefault(); send(); });
        el.text.addEventListener('input', () => { autosize(); if (current) saveDraft(current, el.text.value); });
        el.text.addEventListener('keydown', e => {
            // A keyboard: Enter sends, Shift+Enter is a new line. A phone keeps Enter for new lines.
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !window.matchMedia('(pointer: coarse)').matches) {
                e.preventDefault();
                send();
            }
        });
        el.pushBtn.addEventListener('click', pushTap);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { clearTimeout(threadTimer); clearTimeout(listTimer); return; }
            loadConversations().catch(() => {});
            if (current) refreshThread().catch(() => {});
            scheduleThread();
            scheduleList();
        });
        window.addEventListener('resize', measureHeader);

        // The phone menu, as on the other app pages
        const toggle = document.querySelector('.menu-toggle');
        const nav = document.querySelector('.main-nav');
        if (toggle && nav) {
            const setOpen = open => {
                nav.classList.toggle('active', open);
                toggle.classList.toggle('is-open', open);
                toggle.setAttribute('aria-expanded', String(open));
                toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
                document.body.style.overflow = open ? 'hidden' : '';
            };
            toggle.addEventListener('click', () => setOpen(!nav.classList.contains('active')));
            nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
            document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
        }
    }

    async function start() {
        measureHeader();
        wire();
        if (!window.supabase) {
            gate('Messages', 'Couldn’t reach the login service. Check your signal, turn off any strict ad-blocker, then refresh the page.');
            return;
        }
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        let session = null;
        try {
            ({ data: { session } } = await sb.auth.getSession());
        } catch (e) { /* treated as signed out */ }
        if (!session) {
            gate('Messages', 'Log in to message the crew.', { label: 'Log in', href: LOGIN_URL });
            return;
        }
        // Who you can message: also tells us whether messages are set up and open to you
        const { data, error } = await sb.rpc('message_contacts');
        if (error) { gateFor(error); return; }
        contacts = Array.isArray(data) ? data : [];
        try {
            await loadConversations();
        } catch (err) {
            gateFor(err);
            return;
        }
        el.gate.hidden = true;
        el.layout.hidden = false;
        measureHeader();
        renderPush();
        const id = new URLSearchParams(location.search).get('with');
        if (id && UUID.test(id)) openThread(id);
        scheduleList();
    }

    start();
})();
