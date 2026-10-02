/* ==========================================================================
   Bros before Boges — trip configuration
   --------------------------------------------------------------------------
   Everything the public homepage shows about the trip lives here. Update this
   file each year; script.js (homepage) and admin.js (score entry) read it.
   ========================================================================== */
window.BBB = {
    trip: {
        name: 'Bros before Boges',
        year: 2027,
        location: 'Scottsdale, Arizona',
        locationShort: 'Scottsdale, AZ',
        region: 'Phoenix & Scottsdale',
        regionNote: 'Talking Stick is ~15 min from Old Town Scottsdale; We-Ko-Pa is ~30.',
        dates: {
            start: '2027-04-08',
            end: '2027-04-11',
            label: 'April 8–11, 2027',
            short: 'Apr 8–11',
            days: 'Thu–Sun',
            note: 'Thursday through Sunday — the same week as the Masters.'
        },
        // Arizona stays on MST (UTC-7) all year — no daylight saving.
        countdownTarget: '2027-04-08T07:00:00-07:00',
        countdownLabel: 'Countdown to Scottsdale',
        // The trip's own time zone. From dates.start through dates.end the homepage switches to
        // trip-day mode (a Today card, Live scores and Keep score up top), and after dates.end to
        // "That's a wrap", by the date here, never the phone's own clock (the crew flies in from
        // other time zones). timeZoneName is how the page says it, e.g. "6:45 AM (Arizona)".
        // To check trip-day mode early, open the homepage with ?preview=2027-04-09T06:45 (read as
        // this time zone); a ribbon marks the preview and its Exit link drops it.
        timeZone: 'America/Phoenix',
        timeZoneName: 'Arizona',
        hq: {
            name: 'TBA',
            note: 'Lodging is still being locked in. Scottsdale area.',
            link: null
        },
        airport: {
            code: 'PHX',
            name: 'Sky Harbor',
            note: 'About 20 min to Talking Stick and 30 to We-Ko-Pa (without traffic). American flies nonstop from Lubbock (LBB) for about $450 round trip.',
            // Flight times for the Fly into card, plain text, e.g. arriveBy: '10 AM Thu', departAfter: '3 PM Sun'
            // ("Land by 10 AM Thu · fly out after 3 PM Sun"). Both null: "Hold off on flights until tee times post."
            arriveBy: null,
            departAfter: null
        },
        weather: {
            value: 'Mid-80s & sunny',
            note: 'April averages ~85°F highs and ~60°F lows. Rain is rare. Sunset around 6:55 PM.'
        },
        cost: {
            perPerson: 1413,
            approx: true,
            excludes: 'airfare (~$450)',
            note: 'Estimated per man: golf plus a shared room (two to a room at about $175 a night). Plus your flight, about $450 round trip on American’s nonstop from Lubbock. Prices can still change.',
            // Add line items when they're known, e.g. { label: 'Golf', amount: 850 }
            breakdown: [
                { label: 'Talking Stick · Thu practice', amount: 250 },
                { label: 'We-Ko-Pa · 36 holes Fri', amount: 650 },
                { label: 'Camelback Ambiente · Sat', amount: 250 },
                { label: 'Room · 3 nights, 2 to a room', amount: 263 }
            ],
            // How to pay, once there's something to pay; leave out any part, e.g. { label: 'Deposit', amount: 500,
            // due: '2026-12-15', how: 'Venmo @handle', note: 'Balance due Mar 1.' } ("Deposit $500 due Dec 15 · Venmo
            // @handle · Balance due Mar 1."). amount is shown exactly (203.13 is $203.13); due is 'YYYY-MM-DD' or text.
            // null: "Don't send money yet. Payment details come with the final breakdown."
            payment: { label: 'Deposit', amount: 500, due: '2026-11-30', how: 'Venmo @Westin-Tucker' }
        },
        intro: [
            'The Sonoran Desert in April: 80-degree days, cool nights, and some of the best public golf in the country. This year we trade the Texas Hill Country for saguaros, Four Peaks, and firm, fast desert fairways.',
            'Two tribal-owned clubs anchor the trip. Talking Stick sits on Salt River Pima-Maricopa land minutes from Old Town Scottsdale, and We-Ko-Pa sits out on the Fort McDowell Yavapai Nation with no homes or roads along its fairways. Saturday’s final round is back in Scottsdale on Camelback Golf Club’s Ambiente course.'
        ],
        // News at the top of The Trip section, shown newest first as "Oct 1 · …" (the latest three, then
        // "Show older"). One entry per piece of news, date as 'YYYY-MM-DD' and plain text, e.g.
        // { date: '2026-12-01', text: 'HQ is booked.' } (A date typed any other way shows the entry first, undated.)
        // (An older config's single announcement: { title, body } still shows when this list is empty or missing.)
        updates: [
            { date: '2026-10-02', text: 'Thursday at Talking Stick is now a practice round: no Cup points. The Cup is three rounds: We-Ko-Pa Cholla Friday morning, Saguaro Friday afternoon, and Camelback Ambiente on Saturday.' },
            { date: '2026-10-02', text: 'Planning numbers: rooms are running about $175 a night, two to a room (about $263 each for the three nights), and American’s nonstop from Lubbock is about $450 round trip. Both are estimates, not final prices.' },
            { date: '2026-10-02', text: 'Deposit is $500 a man, due Nov 30. Venmo it to Westin (@Westin-Tucker). Golf runs about $1,150: the Talking Stick practice round $250, We-Ko-Pa’s 36 holes $650, Camelback Ambiente $250. Prices can still change.' },
            { date: '2026-10-01', text: 'Final round set: Camelback Golf Club’s Ambiente course on Saturday. All four rounds are locked in. RSVPs are due Nov 30 so we can book rooms.' }
        ],
        // "Still to come", listed beside the updates until the trip starts. Plain text, e.g. 'Tee times';
        // delete each one once it's settled. An empty list hides it.
        stillToCome: ['HQ / lodging', 'Tee times', '2027 Cup formats', 'Course for the optional Sunday round']
    },

    // RSVP / head count. Needs rsvp_schema.sql and then rsvp_accounts.sql run in Supabase.
    // Every RSVP belongs to a player account (the same login as The Bookie).
    rsvp: {
        year: 2027,
        // RSVP-by date, 'YYYY-MM-DD' in Arizona time: "Lock it in by Nov 30 so we can book rooms." on the head count,
        // the RSVP sheet and the Probably screen, then "RSVPs were due Nov 30." once it's passed. null shows nothing.
        lockBy: '2026-11-30',
        // Set a number (e.g. 16) to show an "X of 16 spots" progress bar.
        target: null,
        // Email each RSVP to the alerts inbox below.
        emailNotify: true,
        sundayQuestion: 'I’m up for the optional Sunday morning round (Apr 11)'
    },

    // Where RSVP and new-player alerts are emailed (sent through formsubmit.co).
    // The first alert to a new "to" address is held until someone clicks the
    // activation link FormSubmit emails to that address.
    alerts: {
        to: 'brosbeforeboges@lokdit.net',
        cc: 'jeff.tarlton@lokdit.net'
    },

    // Sign-in options. Google is built but parked: set google to true only after the
    // Google provider is set up in Supabase (steps in email-templates/README.md).
    // Even then, the buttons stay hidden until Supabase reports Google as enabled.
    auth: {
        google: false
    },

    // Flip to true once teams are drafted and last year's scores are cleared in Admin.
    // While false, the homepage shows last year's champions instead of live teams/scores,
    // and the Scoreboard shows pre-tournament rankings.
    season: { live: false },

    // The Bookie (side bets). Bets made before seasonStart belong to earlier trips: they move to
    // the "Past Trips" tab and drop out of this year's ledger. Move the date up after each trip.
    // Settle or cancel open bets before moving this date: older bets become Past Trips and can't be settled.
    bookie: { seasonStart: '2026-06-01' },

    hero: {
        subtitle: 'Four days in the Sonoran Desert: Coore & Crenshaw fairways, a 36‑hole Friday at We-Ko-Pa, and the Cup on the line. Higher stakes, faster greens, same idiots.',
        roundsLabel: '4 rounds · 72 holes',
        roundsNote: '+ optional Sunday',
        images: [
            'assets/courses/wekopa-saguaro/desert-mountain-vista.jpg',
            'assets/courses/wekopa-cholla/aerial-green-bunkers-dusk.jpg',
            'assets/courses/wekopa-saguaro/hole-4-fairway.jpg'
        ]
    },

    scoreboardImage: 'assets/courses/wekopa-saguaro/hole-14-panorama.jpg',

    itineraryLede: 'Tee times get posted here as they’re booked. Plan to land in Phoenix early enough on Thursday for the practice round at Talking Stick.',
    // Each day of the trip. A slot labelled when: 'R1', 'R2', … IS that Cup round: the Round Tracker, Admin (round
    // tabs, Fill from Round Tracker) and the homepage's Keep score button all go by that label, so keep it in step
    // with roundCourses and roundPlay below. Any other label ('Prac', 'AM', 'PM') is on the schedule but not in the Cup,
    // and a trip day with no R<n> slot hides Keep score. practice: true marks a practice round: no Cup points, and
    // the tracker says so that day. To make a practice round count, label it R<n>, drop practice, renumber the later
    // slots and add the round to roundCourses and roundPlay (and its course card's `round` label).
    itinerary: [
        {
            date: '2027-04-08',
            title: 'Wheels down, tees up',
            text: 'Land at PHX and head straight to Talking Stick, about 20 minutes from the airport, for a practice round. No Cup points: shake off the flight and learn the greens.',
            tag: 'Practice round',
            tagSoft: true,
            media: { type: 'image', src: 'assets/courses/talking-stick-oodham/card/oodham-sunset-over-fairways.jpg', alt: 'Sun setting over the O’odham Course at Talking Stick' },
            slots: [
                { when: 'Prac', practice: true, what: 'Talking Stick · O’odham', meta: 'Practice round · tee time TBA', courseId: 'talking-stick-oodham' }
            ]
        },
        {
            date: '2027-04-09',
            title: '36-hole Friday',
            text: 'The Cup starts here: Cholla in the morning, lunch, then Saguaro. Both courses are at We-Ko-Pa, so there’s no drive in between.',
            tag: '36 holes',
            media: { type: 'split', srcs: ['assets/courses/wekopa-cholla/thumbs/four-peaks-fairway-vista.jpg', 'assets/courses/wekopa-saguaro/thumbs/saguaro-cactus-green.jpg'] },
            slots: [
                { when: 'R1', what: 'We-Ko-Pa · Cholla', meta: 'Morning · tee time TBA', courseId: 'wekopa-cholla' },
                { when: 'R2', what: 'We-Ko-Pa · Saguaro', meta: 'Afternoon · tee time TBA', courseId: 'wekopa-saguaro' }
            ]
        },
        {
            date: '2027-04-10',
            title: 'The final round',
            text: 'The last Cup round of the trip, back in Scottsdale on Camelback’s Ambiente course.',
            tag: 'Round 3',
            media: { type: 'image', src: 'assets/courses/camelback-ambiente/card/hole-13-bunker-mountain.jpg', alt: 'A big-walled bunker on Ambiente’s 13th hole below a rugged desert mountain' },
            slots: [
                { when: 'R3', what: 'Camelback · Ambiente', meta: 'Tee time TBA', courseId: 'camelback-ambiente' }
            ]
        },
        {
            date: '2027-04-11',
            title: 'Dawn patrol & Masters Sunday',
            text: 'An optional early round for anyone who’s up for it (sunrise is ~6:00 AM), then flights home. It’s also the final round of the Masters, and Arizona is three hours behind Augusta.',
            tag: 'Optional',
            tagSoft: true,
            media: { type: 'dawn' },
            slots: [
                { when: 'AM', what: 'Optional early round', meta: 'Course TBA' },
                { when: 'PM', what: 'Fly home', meta: 'Masters final round on every airport TV' }
            ]
        }
    ],

    // Which course each Cup round is played on (used for par on the scoreboard and in Admin score entry). Keys are
    // the Cup rounds, the same numbers as the itinerary's R<n> slots: 1 We-Ko-Pa Cholla (Fri AM), 2 Saguaro (Fri PM),
    // 3 Camelback Ambiente (Sat). Thursday's Talking Stick round is a practice round, so it has no number here; its
    // course comes from its itinerary slot. If Talking Stick switches to Piipaash, change that slot's courseId and the
    // Talking Stick course entry's `selected` below to 'talking-stick-piipaash'.
    roundCourses: {
        1: 'wekopa-cholla',
        2: 'wekopa-saguaro',
        3: 'camelback-ambiente'
    },
    // 'stableford' rounds rank by points (highest wins); everything else is stroke play.
    // Round 1 (The Grind, a points round) ranks by points, to match the Admin score-entry math.
    roundScoring: { 1: 'stableford' },
    roundFormats: {},
    // How the Round Tracker scores each round and works out the matches (Admin > Matchups sets who
    // plays whom). Keys are the Cup rounds (1–3); the practice round has none. These are the 2026 formats;
    // update them once the 2027 formats are set (and the Rules page with them).
    //   'points'   two-man teams, own ball: eagle+ 5, birdie 3, par 2, bogey 1; more points wins
    //   'split'    two-man teams, one ball: front 9 and back 9 are separate stroke contests, triple bogey max
    //   'shared'   two-man teams, one ball (scramble or alternate shot), 18-hole match play
    //   'bestball' two-man teams, own ball, better score counts, match play
    //   'singles'  one-on-one match play
    //   'stroke'   everyone for themselves, no matches
    roundPlay: { 1: 'points', 2: 'split', 3: 'singles' },

    courses: [
        {
            id: 'talking-stick',
            anchor: 'talking-stick',
            club: 'Talking Stick Golf Club · Scottsdale',
            round: 'Practice · <b>Thu, Apr 8</b>',
            when: 'Thursday, April 8 · Practice round',
            // Talking Stick has two courses. `selected` is the one we're playing; the other stays here
            // as a backup. Remove `selected` to show both as tabs again.
            selected: 'talking-stick-oodham',
            options: [
                {
                    id: 'talking-stick-oodham',
                    name: 'O’odham Course',
                    shortName: 'O’odham (North)',
                    aka: 'Formerly the North Course',
                    tagline: 'Wide fairways, sneaky greens, zero excuses.',
                    description: 'Coore & Crenshaw took a pancake-flat piece of desert and built a links on it: big, open fairways, greens that shed anything half-hearted, and not a single artificial lake. It rewards the guy who plays the angles over the guy who just bombs it, and the bump-and-run is very much in play.',
                    designer: 'Bill Coore & Ben Crenshaw',
                    opened: 1998,
                    stats: [
                        { label: 'Par', value: '70' },
                        { label: 'Yards', value: '7,133', sub: 'Black tees' },
                        { label: 'Rating', value: '72.6', sub: 'Black tees' },
                        { label: 'Slope', value: '124', sub: 'Black tees' }
                    ],
                    midTees: 'Gold tees · 6,510 yds · 69.9 / 119',
                    holePars: [4, 5, 4, 4, 4, 3, 4, 3, 4, 4, 3, 4, 4, 4, 4, 3, 5, 4],
                    holeYards: [394, 552, 450, 433, 391, 223, 457, 153, 446, 437, 261, 392, 391, 445, 461, 194, 582, 471],
                    yardsTeeName: 'Black tees',
                    signatureHoles: [
                        { hole: 3, par: 4, yards: 450, blurb: '“Sand Hills” is the No. 1 handicap hole, with the out-of-bounds fence running along it. Bogey is a fine score.' },
                        { hole: 11, par: 3, yards: 261, blurb: '“The Big Battle” is a par 3 over a huge bunker, and it plays 217 even from the Golds. Walking off with a bogey counts as a small win.' },
                        { hole: 12, par: 4, yards: 392, blurb: '“Red Mountain” has a big sandy waste area splitting the landing zone. Pick the safe side or the side that sets up the better approach.' }
                    ],
                    accolades: [
                        'No. 10 in Arizona · GOLF (2024–25)',
                        'Golf Digest · 25 best you can play in Scottsdale'
                    ],
                    images: [
                        { src: 'assets/courses/talking-stick-oodham/oodham-sunset-over-fairways.jpg', thumb: 'assets/courses/talking-stick-oodham/thumbs/oodham-sunset-over-fairways.jpg', alt: 'Sun setting over open, mesquite-dotted fairways on the O’odham Course', w: 1600, h: 600 },
                        { src: 'assets/courses/talking-stick-oodham/bunkered-green-mountains.jpg', thumb: 'assets/courses/talking-stick-oodham/thumbs/bunkered-green-mountains.jpg', alt: 'Bunkered O’odham green below a rugged mountain range', w: 1000, h: 389 },
                        { src: 'assets/courses/talking-stick-oodham/fairways-resort-tower.jpg', thumb: 'assets/courses/talking-stick-oodham/thumbs/fairways-resort-tower.jpg', alt: 'O’odham fairways and a bunker with the Talking Stick Resort tower on the horizon', w: 1000, h: 389 },
                        { src: 'assets/courses/talking-stick-club/clubhouse-patio-dusk.jpg', thumb: 'assets/courses/talking-stick-club/thumbs/clubhouse-patio-dusk.jpg', alt: 'Talking Stick clubhouse patio at dusk with a fire pit and string lights', w: 1600, h: 600 }
                    ],
                    heroAspect: '2 / 1',
                    credit: { name: 'Talking Stick Golf Club', url: 'https://www.talkingstickgolfclub.com/oodham-course/' }
                },
                {
                    id: 'talking-stick-piipaash',
                    name: 'Piipaash Course',
                    shortName: 'Piipaash (South)',
                    tagline: 'Tree-lined, lake-laced, Coore & Crenshaw fun.',
                    description: 'The shorter, more traditional half of Talking Stick plays like a parkland course dropped into the desert: tree-lined fairways, raised greens that reward a well-struck approach, and a chain of lakes on the back nine. The trouble is right in front of you, so swing freely and keep the pace up.',
                    designer: 'Bill Coore & Ben Crenshaw',
                    opened: 1998,
                    stats: [
                        { label: 'Par', value: '71' },
                        { label: 'Yards', value: '6,833', sub: 'Black tees' },
                        { label: 'Rating', value: '72.0', sub: 'Black tees' },
                        { label: 'Slope', value: '126', sub: 'Black tees' }
                    ],
                    midTees: 'Gold tees · 6,430 yds · 69.7 / 120',
                    holePars: [4, 4, 3, 4, 4, 4, 5, 4, 3, 4, 4, 4, 3, 5, 4, 5, 3, 4],
                    holeYards: [405, 419, 228, 327, 471, 386, 516, 476, 177, 404, 392, 441, 152, 541, 443, 548, 184, 323],
                    yardsTeeName: 'Black tees',
                    signatureHoles: [
                        { hole: 5, par: 4, yards: 471, blurb: '“Sandy House” is the No. 1 handicap hole: long, tree-lined, and bunkered down the right.' },
                        { hole: 11, par: 4, yards: 392, blurb: '“Cattail Plant” bends left around a lake. The more water you bite off, the shorter the approach.' },
                        { hole: 17, par: 3, yards: 184, blurb: '“Little River” has water down the whole right side up to the green. It’s built for a late-round closest-to-the-pin bet.' }
                    ],
                    accolades: [
                        'No. 47 · Golfweek Top 50 Casino Courses (2025)'
                    ],
                    images: [
                        { src: 'assets/courses/talking-stick-piipaash/piipaash-lakes-aerial-mcdowells.jpg', thumb: 'assets/courses/talking-stick-piipaash/thumbs/piipaash-lakes-aerial-mcdowells.jpg', alt: 'Sunrise aerial of the Piipaash Course’s lakes and fairways with mountain ranges beyond', w: 2400, h: 1350 },
                        { src: 'assets/courses/talking-stick-piipaash/lakeside-green-sunrise.jpg', thumb: 'assets/courses/talking-stick-piipaash/thumbs/lakeside-green-sunrise.jpg', alt: 'Bunkered green beside a lake dotted with pelicans at sunrise', w: 2400, h: 1350 },
                        { src: 'assets/courses/talking-stick-piipaash/lake-and-red-mountain.jpg', thumb: 'assets/courses/talking-stick-piipaash/thumbs/lake-and-red-mountain.jpg', alt: 'Blue lake and bunkered green with Red Mountain in the distance', w: 1600, h: 600 },
                        { src: 'assets/courses/talking-stick-piipaash/green-bunkers-red-mountain.jpg', thumb: 'assets/courses/talking-stick-piipaash/thumbs/green-bunkers-red-mountain.jpg', alt: 'Raised green ringed by bunkers and desert trees beneath Red Mountain', w: 1600, h: 600 },
                        { src: 'assets/courses/talking-stick-piipaash/lake-reflection-mcdowell-mountains.jpg', thumb: 'assets/courses/talking-stick-piipaash/thumbs/lake-reflection-mcdowell-mountains.jpg', alt: 'Mountains reflected in a glassy lake beside a Piipaash green', w: 1600, h: 600 },
                        { src: 'assets/courses/talking-stick-piipaash/golden-hour-fairways-sunburst.jpg', thumb: 'assets/courses/talking-stick-piipaash/thumbs/golden-hour-fairways-sunburst.jpg', alt: 'Low sun over tree-lined fairways and a pond at Talking Stick', w: 2400, h: 1350 }
                    ],
                    credit: { name: 'Talking Stick Golf Club', url: 'https://www.talkingstickgolfclub.com/piipaash-course/' }
                }
            ]
        },
        {
            id: 'wekopa-cholla',
            anchor: 'wekopa-cholla',
            club: 'We-Ko-Pa Golf Club · Fort McDowell',
            round: 'Round 1 · <b>Fri AM</b>',
            when: 'Friday, April 9 · Morning',
            name: 'Cholla',
            tagline: 'Forced carries. Four Peaks. Bring extra balls.',
            description: 'Scott Miller’s original We-Ko-Pa layout is the longer, higher-rated half of the pair. It climbs over desert ridges and drops into arroyos, and nearly every tee shot asks how much desert you want to take on. Bring your best swing and a few spare balls.',
            designer: 'Scott Miller',
            opened: 2001,
            stats: [
                        { label: 'Par', value: '72' },
                        { label: 'Yards', value: '7,225', sub: 'Cholla tees' },
                        { label: 'Rating', value: '73.4', sub: 'Cholla tees' },
                        { label: 'Slope', value: '138', sub: 'Cholla tees' }
                    ],
                    midTees: 'Composite tees · 6,436 yds · 69.4 / 126',
            holePars: [4, 5, 3, 4, 3, 4, 4, 5, 4, 5, 3, 4, 4, 3, 4, 4, 5, 4],
            holeYards: [351, 588, 178, 469, 207, 436, 350, 605, 459, 566, 220, 390, 420, 177, 327, 472, 578, 432],
            yardsTeeName: 'Cholla tees',
            signatureHoles: [
                { hole: 1, par: 4, yards: 351, blurb: 'An elevated opener that dares you to cut the corner over desert toward Red Mountain. Pull it off and it’s a flip wedge in.' },
                { hole: 8, par: 5, yards: 605, blurb: 'The longest hole and No. 1 handicap: clear an arroyo off the tee, then play down to a green fronted by a stacked-rock wall, with the Superstition and Mazatzal ranges in view.' },
                { hole: 11, par: 3, yards: 220, blurb: 'Half the group reaches for hybrid and the other half pretends they aren’t.' }
            ],
            accolades: [
                'No. 8 in Arizona · Golfweek public-access (2026)',
                'No. 23 · Golfweek Top 50 Casino Courses (2025)'
            ],
            images: [
                { src: 'assets/courses/wekopa-cholla/golden-hour-fairway-mountains.jpg', thumb: 'assets/courses/wekopa-cholla/thumbs/golden-hour-fairway-mountains.jpg', alt: 'Sweeping Cholla fairway lined with palo verde and saguaros under a golden sky', w: 1800, h: 850 },
                { src: 'assets/courses/wekopa-cholla/aerial-green-bunkers-dusk.jpg', thumb: 'assets/courses/wekopa-cholla/thumbs/aerial-green-bunkers-dusk.jpg', alt: 'Low aerial of a Cholla green ringed by bunkers in golden sunlight', w: 2400, h: 1538 },
                { src: 'assets/courses/wekopa-cholla/four-peaks-fairway-vista.jpg', thumb: 'assets/courses/wekopa-cholla/thumbs/four-peaks-fairway-vista.jpg', alt: 'Rolling Cholla fairways toward the silhouette of Four Peaks at sunrise', w: 1600, h: 1067 },
                { src: 'assets/courses/wekopa-cholla/hole-8-approach-superstitions.jpg', thumb: 'assets/courses/wekopa-cholla/thumbs/hole-8-approach-superstitions.jpg', alt: 'Cholla No. 8 rolling down to a rock-walled green with a rugged desert mountain range beyond', w: 1583, h: 1920 },
                { src: 'assets/courses/wekopa-club/clubhouse-lake-mountains.jpg', thumb: 'assets/courses/wekopa-club/thumbs/clubhouse-lake-mountains.jpg', alt: 'We-Ko-Pa clubhouse on a ridge above a lake and green', w: 1800, h: 850 },
            ],
            credit: { name: 'We-Ko-Pa Golf Club', url: 'https://wekopa.com/cholla-course/' }
        },
        {
            id: 'wekopa-saguaro',
            anchor: 'wekopa-saguaro',
            club: 'We-Ko-Pa Golf Club · Fort McDowell',
            round: 'Round 2 · <b>Fri PM</b>',
            when: 'Friday, April 9 · Afternoon',
            name: 'Saguaro',
            tagline: 'Arizona’s No. 1 public course. Walk it off.',
            description: 'Golfweek has ranked it Arizona’s No. 1 public-access course two years running. Coore & Crenshaw barely moved any dirt, so the fairways follow the desert’s natural roll, the greens run firm and fast, and no houses line the fairways. It finishes beside an Adirondack-chair lounge on 18, which is where Friday’s bets get settled.',
            designer: 'Bill Coore & Ben Crenshaw',
            opened: 2006,
            stats: [
                        { label: 'Par', value: '71' },
                        { label: 'Yards', value: '6,966', sub: 'Saguaro tees' },
                        { label: 'Rating', value: '72.0', sub: 'Saguaro tees' },
                        { label: 'Slope', value: '137', sub: 'Saguaro tees' }
                    ],
                    midTees: 'Purple tees · 6,603 yds · 70.2 / 132',
            holePars: [4, 4, 4, 5, 3, 4, 4, 5, 3, 4, 3, 4, 4, 5, 3, 4, 4, 4],
            holeYards: [469, 336, 416, 631, 178, 442, 331, 515, 137, 337, 197, 476, 470, 538, 255, 328, 402, 508],
            yardsTeeName: 'Saguaro tees',
            signatureHoles: [
                { hole: 4, par: 5, yards: 631, blurb: 'The longest hole on the property and the No. 1 handicap, a true three-shotter aimed at a wall of blue mountains.' },
                { hole: 13, par: 4, yards: 470, blurb: 'A dogleg left with a huge fairway and one bunker in the middle, about 280 out from the tips. This is the long-drive hole.' },
                { hole: 15, par: 3, yards: 255, blurb: 'A long, narrow green with bunkers down the left. Plenty of the crew will be reaching for a wood, maybe even driver.' }
            ],
            accolades: [
                'No. 1 public-access in Arizona · Golfweek (2025 & 2026)',
                'No. 61 · GOLF Top 100 You Can Play (2024–25)'
            ],
            images: [
                { src: 'assets/courses/wekopa-saguaro/desert-mountain-vista.jpg', thumb: 'assets/courses/wekopa-saguaro/thumbs/desert-mountain-vista.jpg', alt: 'Saguaro green guarded by two bunkers in warm, low-angle light with rugged mountains behind', w: 2400, h: 1538 },
                { src: 'assets/courses/wekopa-saguaro/hole-4-fairway.jpg', thumb: 'assets/courses/wekopa-saguaro/thumbs/hole-4-fairway.jpg', alt: 'Wide rolling fairway on Saguaro No. 4 with saguaro cacti and blue mountain ranges', w: 2400, h: 1552 },
                { src: 'assets/courses/wekopa-saguaro/saguaro-cactus-green.jpg', thumb: 'assets/courses/wekopa-saguaro/thumbs/saguaro-cactus-green.jpg', alt: 'Tee view across saguaro cacti to a bunkered green with mountains beyond', w: 1600, h: 1067 },
                { src: 'assets/courses/wekopa-saguaro/hole-14-panorama.jpg', thumb: 'assets/courses/wekopa-saguaro/thumbs/hole-14-panorama.jpg', alt: 'Panorama of a striped Saguaro green and deep bunker', w: 1800, h: 800 },
                { src: 'assets/courses/wekopa-saguaro/hole-18-lounge-golden-hour.jpg', thumb: 'assets/courses/wekopa-saguaro/thumbs/hole-18-lounge-golden-hour.jpg', alt: 'Aerial of the lounge beside Saguaro’s 18th green at golden hour', w: 1534, h: 1126 },
                { src: 'assets/courses/wekopa-club/clubhouse-dusk.jpg', thumb: 'assets/courses/wekopa-club/thumbs/clubhouse-dusk.jpg', alt: 'We-Ko-Pa clubhouse lit up at dusk', w: 1500, h: 1198 },
                { src: 'assets/courses/wekopa-saguaro/clubhouse-pond.jpg', thumb: 'assets/courses/wekopa-saguaro/thumbs/clubhouse-pond.jpg', alt: 'We-Ko-Pa’s desert clubhouse above a green and a still pond', w: 1419, h: 954 },
                { src: 'assets/courses/wekopa-saguaro/walking-the-saguaro.jpg', thumb: 'assets/courses/wekopa-saguaro/thumbs/walking-the-saguaro.jpg', alt: 'Three golfers walking off the tee toward a desert fairway', w: 1400, h: 1060 }
            ],
            credit: { name: 'We-Ko-Pa Golf Club', url: 'https://wekopa.com/saguaro-course/' }
        },
        {
            id: 'camelback-ambiente',
            anchor: 'camelback-ambiente',
            club: 'Camelback Golf Club · Scottsdale',
            round: 'Round 3 · <b>Sat, Apr 10</b>',
            when: 'Saturday, April 10 · Round 3',
            name: 'Ambiente',
            aka: 'Formerly the Indian Bend Course',
            tagline: 'Straight out, straight back. Last round, last chance.',
            description: 'Camelback’s old Indian Bend course was so flat it flooded, so in 2013 Jason Straka lowered the wash and used the dirt to raise the new holes. Now it plays like a desert links: rolling fairways routed straight out and back, with native grasses where turf used to be. It’s the last Cup round of the trip, so whatever you’ve got left, use it here.',
            designer: 'Jason Straka',
            opened: 2013,
            stats: [
                { label: 'Par', value: '72' },
                { label: 'Yards', value: '7,225', sub: 'Black tees' },
                { label: 'Rating', value: '74.2', sub: 'Black tees' },
                { label: 'Slope', value: '138', sub: 'Black tees' }
            ],
            midTees: 'Verde tees · 6,630 yds · 71.9 / 132',
            holePars: [4, 3, 5, 4, 4, 4, 5, 3, 4, 4, 3, 4, 4, 5, 3, 5, 4, 4],
            holeYards: [393, 185, 556, 375, 328, 448, 604, 241, 438, 361, 194, 454, 393, 580, 245, 523, 445, 462],
            yardsTeeName: 'Black tees',
            signatureHoles: [
                { hole: 7, par: 5, yards: 604, blurb: 'The longest hole on the course, and it’s still 569 from the Verdes. Plan on three good ones to get there.' },
                { hole: 13, par: 4, yards: 393, blurb: 'The resort singles this one out for its mix of low- and high-walled bunkers, and the green is tiered. Check the pin before you pick a club.' },
                { hole: 15, par: 3, yards: 245, blurb: 'The longest par 3 on the card plays to a two-tiered green. It’s 204 even from the Verdes, and if you land on the wrong level, a three-putt is in play.' }
            ],
            accolades: [
                'No. 28 in Arizona · Golfweek public-access (2026)',
                'No. 6 in Arizona · GolfPass Golfers’ Choice (2026)',
                'Best New Courses · Golf Digest (2013)'
            ],
            images: [
                { src: 'assets/courses/camelback-ambiente/hole-10-aerial-mountains.jpg', thumb: 'assets/courses/camelback-ambiente/thumbs/hole-10-aerial-mountains.jpg', alt: 'Aerial of Ambiente No. 10 bending left along a native-grass wash, with rugged mountains beyond', w: 1800, h: 808 },
                { src: 'assets/courses/camelback-ambiente/hole-13-bunker-mountain.jpg', thumb: 'assets/courses/camelback-ambiente/thumbs/hole-13-bunker-mountain.jpg', alt: 'Big-walled bunker on Ambiente No. 13 with a rugged desert mountain behind', w: 2400, h: 875 },
                { src: 'assets/courses/camelback-ambiente/hole-5-green-lake.jpg', thumb: 'assets/courses/camelback-ambiente/thumbs/hole-5-green-lake.jpg', alt: 'Bunkered green on Ambiente No. 5 with a lake beyond', w: 1800, h: 808 },
                { src: 'assets/courses/camelback-ambiente/hole-16-aerial-green.jpg', thumb: 'assets/courses/camelback-ambiente/thumbs/hole-16-aerial-green.jpg', alt: 'Aerial of Ambiente’s bunkered 16th green with a lake and fairway beyond', w: 1920, h: 1082 },
                { src: 'assets/courses/camelback-ambiente/native-wash-green-mountains.jpg', thumb: 'assets/courses/camelback-ambiente/thumbs/native-wash-green-mountains.jpg', alt: 'Native-grass wash beside an Ambiente fairway and bunkered green beneath a mountain ridge', w: 1800, h: 541 },
                { src: 'assets/courses/camelback-ambiente/hole-1-aerial.jpg', thumb: 'assets/courses/camelback-ambiente/thumbs/hole-1-aerial.jpg', alt: 'Aerial down Ambiente’s tree-lined opening hole with the Valley stretching to the horizon', w: 1800, h: 808 },
                { src: 'assets/courses/camelback-ambiente/deep-bunker-steps.jpg', thumb: 'assets/courses/camelback-ambiente/thumbs/deep-bunker-steps.jpg', alt: 'Deep bunker with wooden steps in front of an Ambiente green', w: 1800, h: 1200 },
                { src: 'assets/courses/camelback-club/clubhouse-entrance.jpg', thumb: 'assets/courses/camelback-club/thumbs/clubhouse-entrance.jpg', alt: 'Camelback Golf Club’s desert-toned clubhouse and entry drive under a big Arizona sky', w: 1800, h: 808 }
            ],
            heroAspect: '2 / 1',
            credit: { name: 'Camelback Golf Club and JW Marriott Camelback Inn', url: 'https://www.camelbackgolf.com/groups' }
        }
    ],

    photoCredits: 'Course photography courtesy of <a href="https://www.talkingstickgolfclub.com/" target="_blank" rel="noopener">Talking Stick Golf Club</a>, <a href="https://wekopa.com/" target="_blank" rel="noopener">We-Ko-Pa Golf Club</a>, <a href="https://www.camelbackgolf.com/" target="_blank" rel="noopener">Camelback Golf Club</a> and <a href="https://www.marriott.com/en-us/hotels/phxcb-jw-marriott-scottsdale-camelback-inn-resort-and-spa/golf/" target="_blank" rel="noopener">JW Marriott Camelback Inn</a>.',

    cup: {
        // Add the 2027 captains here once they're picked, e.g. ['First Last', 'First Last'].
        // They get the "Capt." tag on the roster and team cards. While this is empty,
        // the Draft card shows captainsNote instead.
        captains: [],
        captainsNote: 'Captains will be selected soon',
        headline: 'Blue holds the hardware.',
        subheadline: 'Red wants revenge.',
        lede: 'Two captains, a draft, and three rounds of team match play. The losing side hears about it for twelve months.',
        trophy: {
            src: 'assets/past_years/web/thumb/img_0708.jpg',
            full: 'assets/past_years/web/img_0708.jpg',
            alt: 'The Bros before Boges trophy: two irons in a range basket on a stepped wooden base',
            caption: 'The Cup'
        },
        trophyTitle: 'The Cup',
        trophyText: 'Two irons, a range basket and a stack of hardwood. It’s the most coveted trophy in amateur golf, at least among us.',
        draftTitle: 'Draft pending',
        draftText: 'Once the captains are named, they’ll draft two teams schoolyard-style from the 2027 roster.',
        points: [
            'Two teams, drafted by the captains',
            'Cup points on the line Friday and Saturday (Thursday is a practice round)',
            'Formats and stakes posted on the Rules page before we tee off'
        ],
        liveNote: 'The official Cup total, updated by the commissioner after every session.'
    },

    // Past editions, newest first. The first entry with a score powers the animated
    // champions reel. rosterDisplay: 'collapsed' (button reveals the squad),
    // 'visible' (always shown) or 'hidden' (never shown).
    // Optional sessions: [{ label: 'Round 1 · Point Quota', blue: 2.5, red: 1.5 }, ...]
    history: [
        {
            year: 2026,
            location: 'Horseshoe Bay, Texas',
            courses: ['Ram Rock', 'Slick Rock', 'Summit Rock'],
            champion: 'blue',
            score: { blue: 10.5, red: 9.5 },
            totalPoints: 20,
            toWin: 10.5,
            captains: { blue: 'David Owens', red: 'Jeff Tarlton' },
            note: 'Blue took the Cup by the narrowest margin possible, 10½ to 9½, at Horseshoe Bay.',
            rosterDisplay: 'collapsed',
            rosters: {
                blue: ['David Owens', 'Alex Indelicato', 'Blake Hayes', 'Jayme McCall', 'Kyle Motheral', 'Parker Davidson', 'Westin Tucker', 'Zac Taylor'],
                red: ['Jeff Tarlton', 'Andy Mazzolini', 'Colby Gibson', 'Derrick Merchant', 'Dillon Griffin', 'Keith Spacek', 'Kelly Dennard', 'Tyler Lyons']
            },
            sessions: []
        },
        {
            // Result not recorded yet: add champion/score (or resultText) and courses when known
            year: 2025,
            location: 'Bandon Dunes, Oregon',
            courses: []
        }
    ],
    hallOfFameNextNote: 'Talking Stick O’odham · We-Ko-Pa Cholla & Saguaro · Camelback Ambiente',

    // Hall of Fame photo wall: one album per trip, newest first. The first photo is the
    // big featured tile; `pos` nudges the crop (CSS object-position) for tall photos.
    // Albums whose `year` matches a history entry get a "View photos" link on that row.
    // Optional shareUrl: an https link to a shared album the crew can add to (Google Photos,
    // iCloud, …). After the trip, the homepage's "That's a wrap" card shows an "Add your photos"
    // button for the album whose `year` matches trip.year; no shareUrl, no button. An album can
    // have a shareUrl and no photos yet, e.g.
    //   { id: '2027', year: 2027, label: '2027 · Scottsdale', shareUrl: 'https://photos.app.goo.gl/…', photos: [] }
    photoAlbums: [
        {
            id: '2026',
            year: 2026,
            label: '2026 · Horseshoe Bay',
            photos: [
                { src: 'assets/past_years/2026/thumb/team-photo.jpg', full: 'assets/past_years/2026/team-photo.jpg', alt: 'The whole crew in matching blue polos under a big oak on the course', pos: '50% 58%' },
                { src: 'assets/past_years/2026/thumb/waterfall-foursome.jpg', full: 'assets/past_years/2026/waterfall-foursome.jpg', alt: 'A foursome selfie in front of the waterfall on the course' },
                { src: 'assets/past_years/2026/thumb/lakeside-green.jpg', full: 'assets/past_years/2026/lakeside-green.jpg', alt: 'Two of the crew walking off a lakeside green lined with lake houses' },
                { src: 'assets/past_years/2026/thumb/reading-the-green.jpg', full: 'assets/past_years/2026/reading-the-green.jpg', alt: 'Reading a putt on a green beside a bunker and live oaks', pos: '50% 40%' },
                { src: 'assets/past_years/2026/thumb/evening-putting-course.jpg', full: 'assets/past_years/2026/evening-putting-course.jpg', alt: 'The crew with putters and drinks on the resort putting course at dusk', pos: '50% 35%' },
                { src: 'assets/past_years/2026/thumb/putting-course-palms.jpg', full: 'assets/past_years/2026/putting-course-palms.jpg', alt: 'Putting-course showdown among the palm trees at dusk' },
                { src: 'assets/past_years/2026/thumb/lakeside-pair.jpg', full: 'assets/past_years/2026/lakeside-pair.jpg', alt: 'Two of the crew with their putters beside a pond and fountain', pos: '50% 40%' },
                { src: 'assets/past_years/2026/thumb/hill-country-putt.jpg', full: 'assets/past_years/2026/hill-country-putt.jpg', alt: 'Lining up a putt with Hill Country views behind the green', pos: '50% 45%' }
            ]
        },
        {
            id: '2025',
            year: 2025,
            label: '2025 · Bandon Dunes',
            photos: [
                { src: 'assets/past_years/web/thumb/img_1567.jpg', full: 'assets/past_years/web/img_1567.jpg', alt: 'Four of the crew on the Bandon links with the Pacific behind them' },
                { src: 'assets/past_years/web/thumb/img_1181.jpg', full: 'assets/past_years/web/img_1181.jpg', alt: 'Four of the crew on a clifftop hole above the Pacific' },
                { src: 'assets/past_years/web/thumb/img_1359.jpg', full: 'assets/past_years/web/img_1359.jpg', alt: 'Two of the crew on a windswept Bandon links hole', pos: '50% 45%' },
                { src: 'assets/past_years/web/thumb/img_1256.jpg', full: 'assets/past_years/web/img_1256.jpg', alt: 'Three of the crew kicking back on a bench between holes' }
            ]
        },
        {
            id: 'earlier',
            label: 'Earlier trips',
            photos: [
                { src: 'assets/past_years/web/thumb/img_0574.jpg', full: 'assets/past_years/web/img_0574.jpg', alt: 'A swing from the fairway on a tree-lined hole', pos: '50% 60%' },
                { src: 'assets/past_years/web/thumb/img_6933.jpg', full: 'assets/past_years/web/img_6933.jpg', alt: 'Two of the crew in matching navy polos on the tee', pos: '50% 40%' },
                { src: 'assets/past_years/web/thumb/img_6936.jpg', full: 'assets/past_years/web/img_6936.jpg', alt: 'The crew warming up on a hillside range' },
                { src: 'assets/past_years/web/thumb/img_6937.jpg', full: 'assets/past_years/web/img_6937.jpg', alt: 'Hitting balls on a hillside range' }
            ]
        }
    ],

    // Player photos in assets/PlayerCards/<FirstLast>.jpg
    playerCards: ['JaymeMcCall']
};
