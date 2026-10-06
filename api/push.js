// Sends one queued notification (public.notifications, push_2027.sql) to every phone its player
// turned notifications on for (public.push_subscriptions).
//
// Called by a Supabase Database Webhook on INSERT into notifications (set up once in the Supabase
// dashboard; the steps are in push_2027.sql's header). Only the row's id is taken from the call:
// the row is re-read with the service role and skipped once sent_at is set, so a repeated call
// can't send twice and a made-up call can't send anything the database didn't queue.
//
// Vercel env vars (Settings -> Environment Variables): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (mailto:...), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUSH_WEBHOOK_SECRET.
const crypto = require('crypto');
const webpush = require('web-push');

const ENV = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PUSH_WEBHOOK_SECRET'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only ever send to the real push services (the database refuses anything else too: push_safe_endpoint)
const PUSH_SERVICE = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]{1,63}\.notify\.windows\.com)\/[^\s\x00-\x1f]+$/;
// Banners worth waking the phone for right away; the rest can wait for its next check-in
const URGENT = new Set(['challenge', 'accepted', 'declined', 'settled', 'voided', 'announcement', 'test']);

function secretOk(given) {
    const want = Buffer.from(String(process.env.PUSH_WEBHOOK_SECRET || ''));
    const got = Buffer.from(String(given || ''));
    return want.length > 0 && want.length === got.length && crypto.timingSafeEqual(want, got);
}

function rest(path, init = {}) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = Object.assign({
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
    }, init.headers || {});
    return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, Object.assign({}, init, { headers }));
}

async function rows(res) {
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    try { return text ? JSON.parse(text) : []; } catch (e) { return []; }
}

const quiet = { headers: { Prefer: 'return=minimal' } };

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const missing = ENV.filter(k => !process.env[k]);
    if (missing.length) return res.status(500).json({ error: `Missing env: ${missing.join(', ')}` });
    if (!secretOk(req.headers['x-bbb-secret'])) return res.status(401).json({ error: 'Bad secret' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const id = body && body.record && body.record.id;
    if (!UUID.test(String(id || ''))) return res.status(400).json({ error: 'No notification id' });

    try {
        // 1. The row, fresh from the database, and only while it's unsent
        const queued = await rows(await rest(`notifications?id=eq.${id}&sent_at=is.null&select=id,player_id,kind,title,body,url,tag`));
        if (!queued.length) return res.status(200).json({ id, skipped: true });
        const n = queued[0];

        // 2. That player's phones
        const subs = await rows(await rest(`push_subscriptions?player_id=eq.${n.player_id}&failed_at=is.null&select=id,endpoint,p256dh,auth`));

        // 3. Send
        webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
        const payload = JSON.stringify({ title: n.title, body: n.body || '', url: n.url || '/', tag: n.tag || '', kind: n.kind });
        const options = { TTL: 86400, urgency: URGENT.has(n.kind) ? 'high' : 'normal' };
        let sent = 0, dropped = 0, failed = 0;
        await Promise.all(subs.map(async s => {
            if (!PUSH_SERVICE.test(String(s.endpoint || ''))) {
                failed++;
                console.error(`push to ${s.id} skipped: not a push service address`);
                return;
            }
            try {
                await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
                sent++;
            } catch (err) {
                const code = err && err.statusCode;
                if (code === 404 || code === 410) {
                    // The phone unsubscribed (notifications off, app removed): forget it
                    dropped++;
                    await rest(`push_subscriptions?id=eq.${s.id}`, Object.assign({ method: 'DELETE' }, quiet)).catch(() => {});
                } else {
                    failed++;
                    console.error(`push to ${s.id} failed:`, code || '', err && err.body ? String(err.body).slice(0, 200) : (err && err.message));
                    // A subscription the push service rejects outright is parked until the phone saves it
                    // again (save_push_subscription clears failed_at). A hiccup (429, 5xx) leaves it as it was, for the next one.
                    if (code && code >= 400 && code < 500 && code !== 429) {
                        await rest(`push_subscriptions?id=eq.${s.id}`, Object.assign({
                            method: 'PATCH',
                            body: JSON.stringify({ failed_at: new Date().toISOString(), fail_reason: `HTTP ${code}` })
                        }, quiet)).catch(() => {});
                    }
                }
            }
        }));

        // 4. Stamp the row so it's never sent twice
        const result = subs.length
            ? `sent ${sent}/${subs.length}${dropped ? `, dropped ${dropped}` : ''}${failed ? `, failed ${failed}` : ''}`
            : 'no devices';
        await rest(`notifications?id=eq.${id}`, Object.assign({
            method: 'PATCH',
            body: JSON.stringify({ sent_at: new Date().toISOString(), result })
        }, quiet));
        return res.status(200).json({ id, devices: subs.length, sent, dropped, failed });
    } catch (err) {
        console.error('push failed:', err);
        return res.status(500).json({ error: String((err && err.message) || err) });
    }
};
