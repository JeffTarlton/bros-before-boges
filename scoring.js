/* ==========================================================================
   Bros before Boges — round scoring (shared)
   --------------------------------------------------------------------------
   Pure functions, no database or page code: hole values, to-par, and the
   status of every match for each format. The Round Tracker uses them for its
   Score, Card and Board tabs.

   Formats (set per round in trip-config.js `roundPlay`):
     points    Two-man teams, own ball. Per player: eagle or better 5, birdie 3,
               par 2, bogey 1, double or worse 0. Team with more points wins.
     split     Two-man teams, one ball. Front 9 and back 9 are separate
               stroke contests worth a point each. Triple bogey is the max.
     shared    Two-man teams, one ball (scramble, alternate shot), 18-hole
               match play.
     bestball  Two-man teams, own ball, the better score counts, match play.
     singles   One against one, match play.
     stroke    Everyone for themselves, stroke play. No matches.
   ========================================================================== */
window.BBBScoring = (function () {
    const HOLES = 18;
    const HOLE_COLS = Array.from({ length: HOLES }, (_, i) => `h${i + 1}`);

    const FORMATS = {
        points: { key: 'points', label: 'Team points', teams: true, sharedBall: false },
        split: { key: 'split', label: 'Front 9 scramble · back 9 alternate shot', teams: true, sharedBall: true, cap: 3 },
        shared: { key: 'shared', label: 'Two-man team, one ball', teams: true, sharedBall: true },
        bestball: { key: 'bestball', label: 'Two-man best ball', teams: true, sharedBall: false },
        singles: { key: 'singles', label: 'Head-to-head match play', teams: false, sharedBall: false },
        stroke: { key: 'stroke', label: 'Stroke play', teams: false, sharedBall: false }
    };
    // Used only when trip-config doesn't say (the 2026 rules)
    const DEFAULT_PLAY = { 1: 'points', 2: 'split', 3: 'singles' };

    function formatFor(roundNumber, cfg) {
        const play = cfg && cfg.roundPlay ? cfg.roundPlay : DEFAULT_PLAY;
        const key = play[roundNumber] || 'stroke';
        return FORMATS[key] || FORMATS.stroke;
    }

    // A stored hole value: a whole number from 1 up, anything else is "not entered"
    function cleanHole(v) {
        const n = Number(v);
        return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
    }

    function holesOf(row) {
        return HOLE_COLS.map(c => cleanHole(row ? row[c] : null));
    }

    function countEntered(holes) {
        return holes.reduce((n, v) => n + (v === null ? 0 : 1), 0);
    }

    // Two phones can end up with two rows for the same player. Start from the fullest row and
    // fill its gaps from the others.
    function mergeHoles(rows) {
        const lists = rows.map(holesOf).sort((a, b) => countEntered(b) - countEntered(a));
        if (!lists.length) return Array(HOLES).fill(null);
        return lists[0].map((v, i) => (v !== null ? v : (lists.find(l => l[i] !== null) || [])[i] ?? null));
    }

    // { strokes, toPar, thru } over the holes entered
    function totals(holes, pars) {
        let strokes = 0, toPar = 0, thru = 0;
        holes.forEach((v, i) => {
            if (v === null) return;
            strokes += v;
            thru++;
            if (pars && pars[i]) toPar += v - pars[i];
        });
        return { strokes, toPar, thru };
    }

    function fmtToPar(n) {
        if (n === 0) return 'E';
        return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
    }

    // The Grind's team points, per player per hole
    function quotaPoints(score, par) {
        if (score === null || !par) return 0;
        const d = score - par;
        if (d <= -2) return 5;
        if (d === -1) return 3;
        if (d === 0) return 2;
        if (d === 1) return 1;
        return 0;
    }

    function scoreName(score, par) {
        if (score === null || !par) return '';
        const d = score - par;
        if (score === 1) return 'ace';
        if (d <= -3) return 'albatross';
        if (d === -2) return 'eagle';
        if (d === -1) return 'birdie';
        if (d === 0) return 'par';
        if (d === 1) return 'bogey';
        if (d === 2) return 'double';
        return 'worse';
    }

    // The highest score a hole may take in this format (split: triple bogey), or null
    function holeCap(format, par) {
        return format.cap && par ? par + format.cap : null;
    }

    // ------------------------------------------------------------------------------------
    // Matches
    // ------------------------------------------------------------------------------------
    // Matchups in the order they were made, so "Match 1" stays Match 1 after an edit: the database
    // returns rows in no fixed order, and an updated row usually moves to the end. By created_at
    // when the table has it, then id, so Admin and every phone number the matches the same way.
    function sortMatchups(matchups) {
        const made = m => { const t = Date.parse(m && m.created_at); return isNaN(t) ? Infinity : t; };
        const byId = (a, b) => {
            if (a.id === b.id) return 0;
            if (a.id === null || a.id === undefined) return 1; // not saved yet: last
            if (b.id === null || b.id === undefined) return -1;
            if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id;
            return String(a.id) < String(b.id) ? -1 : 1;
        };
        return (matchups || []).slice().sort((a, b) => (made(a) - made(b)) || byId(a, b));
    }

    // A matchup's group number and tee time, when Admin has set them (groups_2027.sql). Tidied
    // here so every screen reads them the same way: a group is 1 or more, a time is 'HH:MM'.
    function matchGroup(m) {
        const g = Number(m && m.group_number);
        return Number.isInteger(g) && g > 0 ? g : null;
    }
    function matchTeeTime(m) {
        const t = typeof (m && m.tee_time) === 'string' ? m.tee_time.slice(0, 5) : '';
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null;
    }

    // Matchup rows (t1_player1_id ...) become
    // [{ id, number, group, teeTime, sides: [{ team: 1, ids }, { team: 2, ids }] }]
    // (group and teeTime are null until Admin sets them)
    function matchesFrom(matchups) {
        return sortMatchups(matchups).map((m, i) => ({
            id: m.id,
            number: i + 1,
            group: matchGroup(m),
            teeTime: matchTeeTime(m),
            sides: [
                { team: 1, ids: [m.t1_player1_id, m.t1_player2_id].filter(Boolean) },
                { team: 2, ids: [m.t2_player1_id, m.t2_player2_id].filter(Boolean) }
            ]
        })).filter(m => m.sides[0].ids.length && m.sides[1].ids.length);
    }

    // One side's number on each hole, or null until every player on the side has a score.
    // points: the side's quota points; bestball: the lower score; one ball: the ball's score
    // (capped for split); singles/stroke: the player's score.
    function sideHoles(format, side, holesById, pars) {
        const lists = side.ids.map(id => holesById[id] || Array(HOLES).fill(null));
        return Array.from({ length: HOLES }, (_, i) => {
            const vals = lists.map(l => l[i]);
            if (format.sharedBall) {
                const v = vals.find(x => x !== null);
                if (v === undefined) return null;
                const cap = holeCap(format, pars && pars[i]);
                return cap ? Math.min(v, cap) : v;
            }
            if (vals.some(x => x === null)) return null;
            if (format.key === 'points') return vals.reduce((s, v) => s + quotaPoints(v, pars && pars[i]), 0);
            if (format.key === 'bestball') return Math.min(...vals);
            return vals[0];
        });
    }

    // Match play over holes [from, to] (1-based). Only holes both sides have entered count.
    function matchPlay(a, b, from, to) {
        let lead = 0, thru = 0, closed = null;
        const span = to - from + 1;
        for (let h = from; h <= to; h++) {
            const x = a[h - 1], y = b[h - 1];
            if (x === null || y === null) continue;
            thru++;
            if (x < y) lead++;
            else if (y < x) lead--;
            const left = span - thru;
            if (Math.abs(lead) > left && closed === null) closed = { lead, left };
        }
        const left = span - thru;
        const final = closed !== null || thru === span;
        const result = closed || { lead, left };
        return { lead: result.lead, thru, left: result.left, final, dormie: !final && thru > 0 && Math.abs(lead) === left && lead !== 0 };
    }

    // Stroke total (or points total) over holes [from, to] where both sides have a number
    function sumContest(a, b, from, to, higherWins) {
        let x = 0, y = 0, thru = 0, last = 0;
        for (let h = from; h <= to; h++) {
            if (a[h - 1] === null || b[h - 1] === null) continue;
            x += a[h - 1];
            y += b[h - 1];
            thru++;
            last = h;
        }
        const span = to - from + 1;
        const lead = higherWins ? x - y : y - x; // > 0: side A ahead
        // `last`: the hole number they're through (the back nine reads "thru 12", not "thru 3")
        return { a: x, b: y, lead, thru, last, left: span - thru, final: thru === span };
    }

    // Points for a contest result: [side A, side B]. Final or projected (who leads now).
    function contestPoints(lead, worth) {
        if (lead > 0) return [worth, 0];
        if (lead < 0) return [0, worth];
        return [worth / 2, worth / 2];
    }

    // Everything the board shows for one match
    function matchResult(format, match, holesById, pars) {
        const [A, B] = match.sides;
        const a = sideHoles(format, A, holesById, pars);
        const b = sideHoles(format, B, holesById, pars);
        const parts = [];

        if (format.key === 'split') {
            [['Front 9', 1, 9], ['Back 9', 10, 18]].forEach(([label, from, to]) => {
                const c = sumContest(a, b, from, to, false);
                parts.push({ label, kind: 'strokes', ...c, points: contestPoints(c.lead, 1), started: c.thru > 0 });
            });
        } else if (format.key === 'points') {
            const c = sumContest(a, b, 1, HOLES, true);
            parts.push({ label: '', kind: 'points', ...c, points: contestPoints(c.lead, 1), started: c.thru > 0 });
        } else if (format.key !== 'stroke') {
            const m = matchPlay(a, b, 1, HOLES);
            parts.push({ label: '', kind: 'match', ...m, points: contestPoints(m.lead, 1), started: m.thru > 0 });
        }

        const final = parts.length > 0 && parts.every(p => p.final);
        const started = parts.some(p => p.started);
        const points = parts.reduce((acc, p) => {
            if (!p.started) return acc;
            acc.projected[0] += p.points[0];
            acc.projected[1] += p.points[1];
            if (p.final) { acc.won[0] += p.points[0]; acc.won[1] += p.points[1]; }
            return acc;
        }, { won: [0, 0], projected: [0, 0] });
        return { parts, final, started, points, sideHoles: [a, b] };
    }

    // Short text for one part of a match, from side A's point of view, e.g. "2 UP", "3&2", "AS",
    // "by 2", "+4 pts". `names` = ['Blue', 'Red'] or player names. "All square" is match play's word
    // only: a level stroke or points contest is "Tied".
    function partText(part, names) {
        const who = part.lead > 0 ? names[0] : names[1];
        const n = Math.abs(part.lead);
        if (!part.started) return 'Not started';
        if (part.kind === 'match') {
            if (part.final) {
                if (part.lead === 0) return 'Halved';
                return part.left > 0 ? `${who} wins ${n}&${part.left}` : `${who} wins ${n} UP`;
            }
            if (part.lead === 0) return `All square thru ${part.thru}`;
            return `${who} ${n} UP${part.dormie ? ' (dormie)' : ''} thru ${part.thru}`;
        }
        const thru = part.last || part.thru;
        if (part.kind === 'points') {
            // The leader's total first
            const score = `${part.lead < 0 ? part.b : part.a}–${part.lead < 0 ? part.a : part.b} pts`;
            if (part.final) return part.lead === 0 ? `Tied ${score}` : `${who} wins ${score}`;
            return part.lead === 0 ? `Tied ${score} thru ${thru}` : `${who} leads ${score} thru ${thru}`;
        }
        // strokes
        if (part.final) return part.lead === 0 ? 'Halved' : `${who} wins by ${n}`;
        return part.lead === 0 ? `Tied thru ${thru}` : `${who} by ${n} thru ${thru}`;
    }

    // Cup points for a round from its matches: { won: [blue, red], projected: [blue, red] }.
    // Side A is team 1 (Blue) in every matchup.
    function roundPoints(format, matches, holesById, pars) {
        return matches.reduce((acc, m) => {
            const r = matchResult(format, m, holesById, pars);
            acc.won[0] += r.points.won[0]; acc.won[1] += r.points.won[1];
            acc.projected[0] += r.points.projected[0]; acc.projected[1] += r.points.projected[1];
            return acc;
        }, { won: [0, 0], projected: [0, 0] });
    }

    function fmtPoints(v) {
        const whole = Math.floor(v);
        return v - whole === 0.5 ? `${whole || ''}½` : String(v);
    }

    // Cup points a round's matches are worth: a point a match, a point a nine in split, none in stroke
    function pointsOnLine(format, matches) {
        if (format.key === 'stroke') return 0;
        return (matches || []).length * (format.key === 'split' ? 2 : 1);
    }

    // The Cup across every round: rounds = [{ format, matches, holesById, pars }].
    // won: points from finished matches (and nines); projected: every started match as it stands
    // (finished ones included); total: what all the rounds are worth; toWin: more than half of it,
    // known only once every round has its matches set (null before). decided: 1 or 2 once a team
    // has banked more than half of every point there is (only then: a clinch, never a guess).
    // A round counts as set once it has matches, or, when the caller knows the roster, once its
    // matches cover it (r.complete === false: some still missing).
    function cupTotals(rounds) {
        const out = { won: [0, 0], projected: [0, 0], total: 0, toWin: null, started: false, allSet: true, decided: 0 };
        (rounds || []).forEach(r => {
            if (r.format.key === 'stroke') return;
            if (!r.matches.length || r.complete === false) out.allSet = false;
            out.total += pointsOnLine(r.format, r.matches);
            r.matches.forEach(m => {
                const res = matchResult(r.format, m, r.holesById, r.pars);
                if (res.started) out.started = true;
                out.won[0] += res.points.won[0]; out.won[1] += res.points.won[1];
                out.projected[0] += res.points.projected[0]; out.projected[1] += res.points.projected[1];
            });
        });
        if (out.allSet && out.total) {
            out.toWin = out.total / 2 + 0.5;
            out.decided = out.won[0] >= out.toWin ? 1 : out.won[1] >= out.toWin ? 2 : 0;
        }
        return out;
    }

    // Hole by hole for a match's scorecard: each side's number on every hole, who took the hole and
    // the running margin. win: 1 side A, 2 side B, 0 halved, null until both sides have a number.
    // lead (side A's view): holes up in match play, strokes ahead in split (each nine on its own),
    // points ahead in points rounds. over: the match was already decided before this hole (match
    // play only), so the hole doesn't count.
    function holeMargins(format, match, holesById, pars) {
        const [A, B] = match.sides;
        const a = sideHoles(format, A, holesById, pars);
        const b = sideHoles(format, B, holesById, pars);
        const kind = format.key === 'split' ? 'strokes' : format.key === 'points' ? 'points' : 'match';
        const higher = kind === 'points';
        const spans = kind === 'strokes' ? [[1, 9], [10, HOLES]] : [[1, HOLES]];
        const holes = Array(HOLES).fill(null);
        spans.forEach(([from, to]) => {
            let lead = 0, thru = 0, closed = false;
            for (let h = from; h <= to; h++) {
                const x = a[h - 1], y = b[h - 1];
                if (x === null || y === null) {
                    holes[h - 1] = { win: null, lead: null, over: closed };
                    continue;
                }
                const win = x === y ? 0 : ((higher ? x > y : x < y) ? 1 : 2);
                if (closed) {
                    holes[h - 1] = { win, lead: null, over: true };
                    continue;
                }
                if (kind === 'match') lead += win === 1 ? 1 : win === 2 ? -1 : 0;
                else lead += higher ? x - y : y - x;
                thru++;
                if (kind === 'match' && Math.abs(lead) > (to - from + 1) - thru) closed = true;
                holes[h - 1] = { win, lead, over: false };
            }
        });
        return { kind, a, b, holes };
    }

    // Each player's trip so far: rounds = [{ format, matches, holesById, pars }].
    // { [playerId]: { w, l, h, pts, birdies } }. Only finished matches (or nines, in split) count
    // toward the record and points; every player on the side gets the side's result. Birdies are
    // every hole under par: on the player's own card, or on the side's ball when partners share
    // one (it counts for both partners, even one whose own card has no row).
    function playerRecords(rounds) {
        const rec = {};
        const get = id => (rec[id] = rec[id] || { w: 0, l: 0, h: 0, pts: 0, birdies: 0 });
        const under = (list, pars) => (list || []).filter((v, i) => v !== null && pars && pars[i] && v < pars[i]).length;
        (rounds || []).forEach(r => {
            const viaSide = new Set();
            if (r.format.sharedBall) {
                r.matches.forEach(m => m.sides.forEach(s => {
                    const n = under(sideHoles(r.format, s, r.holesById, r.pars), r.pars);
                    s.ids.forEach(id => { if (!viaSide.has(id)) { get(id).birdies += n; viaSide.add(id); } });
                }));
            }
            Object.keys(r.holesById || {}).forEach(id => {
                if (!viaSide.has(id)) get(id).birdies += under(r.holesById[id], r.pars);
            });
            if (r.format.key === 'stroke') return;
            r.matches.forEach(m => {
                matchResult(r.format, m, r.holesById, r.pars).parts.forEach(p => {
                    if (!p.final) return;
                    m.sides.forEach((s, i) => s.ids.forEach(id => {
                        const x = get(id);
                        x.pts += p.points[i];
                        if (p.lead === 0) x.h++;
                        else if ((p.lead > 0) === (i === 0)) x.w++;
                        else x.l++;
                    }));
                });
            });
        });
        return rec;
    }

    // The trip's standouts for the wrap-up card: rounds = [{ number, format, matches, holesById, pars }].
    // Every list keeps ties (several players can share a best).
    // - topPoints / mostBirdies: from playerRecords, so they match the Player records table.
    // - lowRound: the lowest full 18 on a player's own ball. Rounds where partners share one ball
    //   (split, shared) or only the better ball counts (bestball) are left out: those cards aren't
    //   one player's own score.
    // - biggestWin: the widest finished match-play win (6&5 beats 3&2; 3&2 beats 3&1). Points and
    //   stroke contests use other units, so they don't compete.
    function tripHighlights(rounds) {
        const list = rounds || [];
        const rec = playerRecords(list);
        const best = key => {
            let value = 0, ids = [];
            Object.keys(rec).forEach(id => {
                const v = rec[id][key];
                if (v > value) { value = v; ids = [id]; }
                else if (v === value && v > 0) ids.push(id);
            });
            return value > 0 ? { value, ids } : null;
        };

        let lowRound = null;
        list.forEach(r => {
            if (r.format.sharedBall || r.format.key === 'bestball') return;
            Object.keys(r.holesById || {}).forEach(id => {
                const h = r.holesById[id];
                if (countEntered(h) !== HOLES) return;
                const t = totals(h, r.pars);
                const entry = { id, round: r.number, strokes: t.strokes, toPar: t.toPar };
                const better = !lowRound || t.toPar < lowRound.toPar || (t.toPar === lowRound.toPar && t.strokes < lowRound.strokes);
                if (better) lowRound = { toPar: t.toPar, strokes: t.strokes, entries: [entry] };
                else if (t.toPar === lowRound.toPar && t.strokes === lowRound.strokes) lowRound.entries.push(entry);
            });
        });

        let biggestWin = null;
        list.forEach(r => {
            if (r.format.key === 'stroke' || r.format.key === 'split' || r.format.key === 'points') return;
            (r.matches || []).forEach(m => {
                matchResult(r.format, m, r.holesById, r.pars).parts.forEach(p => {
                    if (p.kind !== 'match' || !p.final || p.lead === 0) return;
                    const n = Math.abs(p.lead);
                    const win = p.lead > 0 ? 0 : 1;
                    const entry = { round: r.number, matchId: m.id, number: m.number, lead: n, left: p.left,
                        winners: m.sides[win].ids, losers: m.sides[1 - win].ids, team: m.sides[win].team,
                        text: p.left > 0 ? `${n}&${p.left}` : `${n} UP` };
                    const cmp = !biggestWin ? 1 : (n - biggestWin.lead) || (p.left - biggestWin.left);
                    if (cmp > 0) biggestWin = { lead: n, left: p.left, entries: [entry] };
                    else if (cmp === 0) biggestWin.entries.push(entry);
                });
            });
        });

        return { topPoints: best('pts'), mostBirdies: best('birdies'), lowRound, biggestWin };
    }

    return {
        HOLES, HOLE_COLS, FORMATS, formatFor, cleanHole, holesOf, countEntered, mergeHoles, totals,
        fmtToPar, quotaPoints, scoreName, holeCap, sortMatchups, matchGroup, matchTeeTime, matchesFrom, sideHoles,
        matchPlay, sumContest, matchResult, partText, roundPoints, fmtPoints, pointsOnLine, cupTotals, holeMargins,
        playerRecords, tripHighlights
    };
})();
