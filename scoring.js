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
        singles: { key: 'singles', label: 'Singles match play', teams: false, sharedBall: false },
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

    // Team point quota, per player per hole
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
    // Matchup rows (t1_player1_id ...) become [{ id, number, sides: [{ team: 1, ids }, { team: 2, ids }] }]
    function matchesFrom(matchups) {
        return (matchups || []).map((m, i) => ({
            id: m.id,
            number: i + 1,
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
    // "by 2", "+4 pts". `names` = ['Blue', 'Red'] or player names.
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
        return part.lead === 0 ? `All square thru ${thru}` : `${who} by ${n} thru ${thru}`;
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

    return {
        HOLES, HOLE_COLS, FORMATS, formatFor, cleanHole, holesOf, countEntered, mergeHoles, totals,
        fmtToPar, quotaPoints, scoreName, holeCap, matchesFrom, sideHoles, matchPlay, sumContest,
        matchResult, partText, roundPoints, fmtPoints
    };
})();
