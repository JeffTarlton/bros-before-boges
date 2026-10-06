/* ==========================================================================
   Bros before Boges — Help: the ? button and the help page (help.html)
   --------------------------------------------------------------------------
   A ? in a circle at the top right of every page, just left of the bell. Tapping it opens Help:
   the answers for the page you're on first, then every other topic by area, with a search box.
   help.html (also /help) shows the same answers as a full page; help.html#<topic id> opens one.

   The answers live in SECTIONS and TOPICS below, the one place to edit them. Each topic:
     id   short and permanent: help.html#id links to it, and other answers point at it
     s    its section (a SECTIONS id)
     q    the question, the way a player would ask it
     a    the answer, as HTML written here (never anything from the database or a visitor).
          <a data-topic="id">…</a> opens another answer; class="ui" marks a button's label;
          <p class="tip"> is a green tip box
     k    extra words people might search for (optional)
   PAGE_TOPICS picks the handful shown first on each page ("On The Bookie"), in order; a key like
   'tracker#score' is used while that tab is open. A section marked organizers: true shows only on
   the Admin page: players never see it in the panel, its search or help.html.
   {spots}, {rsvpBy}, {deposit}, {depositDue}, {payTo}, {dates}, {tz}, {inbox} and {host} come from
   trip-config.js and the address bar (facts() below), so the answers keep up with each year.

   Pages load it after bell.js: <script src="help.js?v=…" defer></script>. It places itself;
   nothing else needs to call it. window.BBBHelp.open('topic-id') opens it on one answer.
   ========================================================================== */
(function () {
    // ---- the answers ----------------------------------------------------------------------------
    const SECTIONS = [
        { id: 'start', title: 'Getting started', blurb: 'New here? Start with these.' },
        { id: 'account', title: 'Your account and logging in', blurb: 'One player account for everything on the site.' },
        { id: 'rsvp', title: 'RSVP and the head count', blurb: 'Saying you’re in, spots and the waitlist.' },
        { id: 'checklist', title: 'Your checklist, deposit and golf profile', blurb: 'What to do before the trip, and paying your deposit.' },
        { id: 'trip', title: 'The trip: schedule, courses and the crew', blurb: 'Everything on the homepage about the trip itself.' },
        { id: 'bookie', title: 'The Bookie: side bets', blurb: 'Head-to-heads, pools and props with the crew.' },
        { id: 'settle', title: 'Settle up: paying each other', blurb: 'Who owes whom, and squaring up on Venmo.' },
        { id: 'score', title: 'Keep score on the course', blurb: 'One phone per group enters the scores, hole by hole.' },
        { id: 'signal', title: 'No signal on the course', blurb: 'Dead zones don’t lose scores. Here’s how it works.' },
        { id: 'live', title: 'Live scores and the Cup', blurb: 'Following every match as it happens.' },
        { id: 'rules', title: 'Rules and formats', blurb: 'The short version. The rules page has the rest.' },
        { id: 'messages', title: 'Messages', blurb: 'Direct messages between players.' },
        { id: 'alerts', title: 'Notifications and the home-screen app', blurb: 'The bell, phone banners and installing the app.' },
        { id: 'privacy', title: 'Privacy: who sees what', blurb: 'What’s public, what’s crew-only and what’s private.' },
        { id: 'trouble', title: 'Something’s not working', blurb: 'Common snags and how to get past them.' },
        { id: 'admin', title: 'For organizers (Admin)', blurb: 'Only for the commissioner and organizers.', organizers: true }
    ];

    const TOPICS = [
        // ---- Getting started
        {
            id: 'whats-here', s: 'start', k: 'about overview features what is this',
            q: 'What can I do on this site?',
            a: `<p>It’s home base for the trip. With one player account you can:</p>
                <ul>
                <li><strong>RSVP</strong> and see who else is in (<a href="/index.html#attendees">The Crew</a>).</li>
                <li>Work through <strong>Your checklist</strong>: deposit, handicap, Venmo and notifications.</li>
                <li>Check the <a href="/index.html#schedule">schedule</a>, tee times and <a href="/index.html#courses">courses</a>.</li>
                <li>Make side bets with the crew in <a href="/bookie.html">The Bookie</a>, then settle up on Venmo.</li>
                <li><a href="/round_tracker.html#setup">Keep score</a> for your group on the course, and follow <a href="/round_tracker.html#board">Live scores</a>.</li>
                <li>Message other players, and get notifications on your phone.</li>
                </ul>`
        },
        {
            id: 'first-steps', s: 'start', k: 'new start begin setup invite signup first time',
            q: 'I’m new. What do I do first?',
            a: `<ol>
                <li><strong>Create your player account.</strong> Tap <span class="ui">RSVP</span> on the homepage (or open the invite link), then <span class="ui">Create my account</span>. Pick your name from the roster list, or <span class="ui">I’m new: add me to the roster</span> if it isn’t there.</li>
                <li><strong>Confirm your email.</strong> Open “Confirm your email” from Bros before Boges and tap the link. It logs you in and takes you to your RSVP. Not there? Check spam.</li>
                <li><strong>RSVP.</strong> Pick <span class="ui">I’m in</span>, <span class="ui">Probably</span> or <span class="ui">Can’t make it</span> and tap <span class="ui">Send my RSVP</span>.</li>
                <li><strong>Work through Your checklist</strong> on the homepage: deposit, handicap, Venmo and notifications.</li>
                <li><strong>Put the site on your home screen</strong> so it opens like an app. <a data-topic="home-screen">Here’s how.</a></li>
                </ol>
                <p class="tip">New to the roster? The commissioner confirms new players. You can RSVP right away; betting, Messages and the deposit open once you’re approved.</p>`
        },
        {
            id: 'one-login', s: 'start', k: 'account password same login one separate',
            q: 'Do I need separate logins for the RSVP, bets and scoring?',
            a: `<p>No. One player account does it all: RSVP, golf profile, The Bookie, Keep score, Messages and notifications (and Admin, for the organizers). Log in once on each phone or computer you use.</p>
                <p class="tip">On an iPhone, the home-screen app keeps its own login, separate from Safari. Log in once inside the app too.</p>`
        },
        {
            id: 'no-login', s: 'start', k: 'public signed out guest without account',
            q: 'What can I see without logging in?',
            a: `<p>Anyone with the link can see the schedule and tee times, the courses, the head count and crew list, the rules and Live scores.</p>
                <p>Log in to RSVP, pay your deposit, edit your golf profile, bet, keep score, send messages, get notifications and open the photo album.</p>`
        },
        {
            id: 'find-things', s: 'start', k: 'navigation menu hamburger bell question mark clubhouse buttons',
            q: 'Where’s the menu, and what are the round buttons at the top?',
            a: `<ul>
                <li><strong>☰ (three lines)</strong>, top right on phones: the menu, with every page and your account (<span class="ui">Golf profile</span>, <span class="ui">Messages</span>, <span class="ui">Log out</span>).</li>
                <li><strong>Clubhouse</strong>, on the homepage on a computer: Keep score, your account and (for organizers) Admin.</li>
                <li><strong>?</strong>: this help, on every page.</li>
                <li><strong>Bell</strong>: your notifications. It shows once you’re logged in and approved.</li>
                </ul>`
        },
        {
            id: 'short-links', s: 'start', k: 'url link share invite address',
            q: 'Are there short links I can text to someone?',
            a: `<p>Add these to the end of the site’s address, like <strong>{host}/live</strong>:</p>
                <ul>
                <li><strong>/signup</strong>: create an account and RSVP (the invite link)</li>
                <li><strong>/rsvp</strong>: open the RSVP</li>
                <li><strong>/live</strong>: Live scores</li>
                <li><strong>/score</strong>: Keep score</li>
                <li><strong>/bets</strong>: The Bookie</li>
                <li><strong>/help</strong>: all of this help</li>
                </ul>`
        },

        // ---- Account
        {
            id: 'create-account', s: 'account', k: 'sign up register new account create',
            q: 'How do I create my player account?',
            a: `<ol>
                <li>Tap <span class="ui">RSVP</span> on the homepage (or use the invite link), then <span class="ui">Create my account</span>. You can also start from <a href="/bookie.html">The Bookie</a> with <span class="ui">Create account</span>.</li>
                <li>Under <strong>Your name on the trip roster</strong>, pick your name. Not listed? Choose <span class="ui">I’m new: add me to the roster</span> at the bottom and type your first and last name.</li>
                <li>Enter your email and a password (at least 6 characters), then tap <span class="ui">Create my account</span>.</li>
                <li>Check your email for <strong>“Confirm your email”</strong> from Bros before Boges and tap the link. You’re logged in and taken straight to your RSVP.</li>
                </ol>`
        },
        {
            id: 'no-email', s: 'account', k: 'confirm email spam verification link didnt get missing junk',
            q: 'I never got the “Confirm your email” message',
            a: `<ul>
                <li>Check your <strong>spam or junk</strong> folder. It comes from Bros before Boges.</li>
                <li>Give it a few minutes. If you tap Create again too soon, it says one is already on its way; you can ask for another after a minute.</li>
                <li>Still nothing? Ask the commissioner.</li>
                </ul>`
        },
        {
            id: 'link-expired', s: 'account', k: 'expired link used confirm didnt work email link',
            q: 'The email link says it expired or didn’t work',
            a: `<p>Each link works once, and only for a while. Go to <a href="/bookie.html">The Bookie</a>, tap <span class="ui">Log in</span> and enter your email and password.</p>
                <p>If it says to confirm your email first, or your password doesn’t work, tap <span class="ui">Forgot password?</span> for a fresh link.</p>`
        },
        {
            id: 'log-in', s: 'account', k: 'sign in login',
            q: 'How do I log in?',
            a: `<p>Tap <span class="ui">Log in</span> (in the menu, on The Bookie, or wherever a page asks), then enter the email and password you signed up with. You come right back to where you were.</p>
                <p class="tip">Each phone, computer and browser logs in on its own. On an iPhone, the home-screen app needs its own login too.</p>`
        },
        {
            id: 'forgot-password', s: 'account', k: 'reset password change forgot',
            q: 'I forgot my password',
            a: `<ol>
                <li>On the Log in screen, type your email, then tap <span class="ui">Forgot password?</span>.</li>
                <li>Open “Reset your password” in your email, on the same phone if you can.</li>
                <li>Choose a new password and tap <span class="ui">Save password</span>. You’re logged in.</li>
                </ol>
                <p>Nothing after a few minutes? Check spam, then ask the commissioner.</p>`
        },
        {
            id: 'pick-name', s: 'account', k: 'link roster name pick your name finish setting up almost there not linked',
            q: 'It says my login isn’t linked to a name on the roster',
            a: `<p>Your login has to be tied to your name on the trip roster before it can RSVP, bet or keep score. On The Bookie, pick your name under <strong>Which name on the roster is you?</strong> and tap <span class="ui">Link my name</span>. First trip? Choose <span class="ui">I’m new: add me to the roster</span>.</p>
                <p>In the homepage menu this shows as <span class="ui">Finish setting up</span>.</p>
                <p>Says your name is <strong>already linked to another login</strong>? You may have signed up twice with different emails. Text the commissioner to sort it out.</p>`
        },
        {
            id: 'approval', s: 'account', k: 'pending approval approve approved confirm confirmed potential new player held waiting commissioner',
            q: 'What does “waiting for the commissioner’s approval” mean?',
            a: `<p>The commissioner checks new players first, and anyone whose login email doesn’t match the email on their roster name. That keeps someone from signing up as you.</p>
                <ul>
                <li><strong>New to the roster</strong> (you chose “I’m new”): you can RSVP right away. Once you’re approved, your name shows on the head count and you can bet, pay your deposit, send messages and get notifications.</li>
                <li><strong>Picked an existing name</strong> with a different email: everything waits until the commissioner confirms it’s you.</li>
                </ul>
                <p>Picked the wrong name? Text the commissioner to unlink it.</p>`
        },
        {
            id: 'log-out', s: 'account', k: 'sign out switch player different account shared phone',
            q: 'How do I log out, or switch to another player?',
            a: `<p>Open the menu (☰, or <strong>Clubhouse</strong> on a computer) and tap <span class="ui">Log out</span>. On The Bookie it’s in the header. Logging out only affects that phone or computer.</p>
                <p>Sharing a phone? In the RSVP, tap <span class="ui">Switch player</span> to log out and log in as someone else.</p>`
        },
        {
            id: 'logged-out', s: 'account', k: 'logged out session expired kicked out',
            q: 'It says “You were logged out”',
            a: `<p>Your login on this phone ended: it was logged out, or it expired. Log in again and carry on. Nothing you’d already saved is lost.</p>
                <p>On the course, scores you enter while logged out stay on the phone. The top of the screen says <span class="ui">Log in to send 2 scores</span>; tap it, log in, and they send.</p>`
        },

        // ---- RSVP
        {
            id: 'rsvp-how', s: 'rsvp', k: 'rsvp going coming attend sign up respond',
            q: 'How do I RSVP?',
            a: `<ol>
                <li>Tap <span class="ui">RSVP</span> at the top of the homepage (or <span class="ui">RSVP now</span>).</li>
                <li>Not logged in? It asks you to log in or create your account first, then brings you back.</li>
                <li>Pick <span class="ui">I’m in</span>, <span class="ui">Probably</span> or <span class="ui">Can’t make it</span>. Tick the Sunday round box if you’re up for it, and add a note if you like.</li>
                <li>Tap <span class="ui">Send my RSVP</span>.</li>
                </ol>
                <p>RSVPs are due <strong>{rsvpBy}</strong>.</p>`
        },
        {
            id: 'rsvp-answers', s: 'rsvp', k: 'probably maybe out answer difference',
            q: 'What’s the difference between In, Probably and Can’t make it?',
            a: `<ul>
                <li><strong>I’m in</strong>: book it. Only an In takes one of the {spots} spots (or a place on the waitlist once they’re gone).</li>
                <li><strong>Probably</strong>: leaning yes, but it doesn’t hold a spot. Lock it in by {rsvpBy}.</li>
                <li><strong>Can’t make it</strong>: you’re out this year. RSVP again if plans change.</li>
                </ul>`
        },
        {
            id: 'rsvp-change', s: 'rsvp', k: 'change answer update rsvp mind',
            q: 'How do I change my RSVP?',
            a: `<p>Tap <span class="ui">Change my RSVP</span> on the homepage (or <span class="ui">Change</span> next to your status), pick your new answer and send it. Your latest answer is the one that counts.</p>
                <p>Changing your note or the Sunday box keeps your place in line. Switching to Probably or Can’t make it and then back to I’m in sends you to the back of the line.</p>
                <p>Says “That’s a lot of RSVP changes”? There’s a limit. Text the commissioner to update yours.</p>`
        },
        {
            id: 'spots', s: 'rsvp', k: 'waitlist spots full cap line order place',
            q: 'How do the spots and the waitlist work?',
            a: `<p>There are <strong>{spots} spots</strong>. They go to approved players in the order they said <strong>I’m in</strong> (and stayed in). The homepage counts down how many are left.</p>
                <p>Once they’re gone, every new I’m in goes on a numbered <strong>waitlist</strong>, in the same order. If someone drops out, the next in line moves up on their own and gets an “A spot opened up” notification.</p>
                <p>Your place shows at the top of the homepage (“You’re #2 on the waitlist”), on Your checklist and in the RSVP.</p>`
        },
        {
            id: 'rsvp-missing', s: 'rsvp', k: 'missing name head count crew list pending not showing',
            q: 'I RSVP’d, but my name isn’t on the head count',
            a: `<p>New to the roster? Your name shows on the head count once the commissioner approves you. Until then you see yourself as a dashed card, “You, waiting on approval”, and nobody else sees it. A new sign-up doesn’t hold a spot until approved; approval puts you in line by the time you said I’m in.</p>
                <p>Already approved? Refresh the page, and check you’re logged in as you: the RSVP says “RSVPing as” your name.</p>`
        },
        {
            id: 'rsvp-note', s: 'rsvp', k: 'note private comment',
            q: 'Who sees the note on my RSVP?',
            a: `<p>Only the organizers. It isn’t on the public head count. Use it for things like “Flying in Wednesday night” or “need a roommate”.</p>`
        },
        {
            id: 'sunday', s: 'rsvp', k: 'sunday optional round',
            q: 'What’s the Sunday round box?',
            a: `<p>Sunday morning’s round is optional. Tick the box if you’re up for it, so the organizers know how many tee times to book. The head count shows how many are in for it.</p>`
        },

        // ---- Checklist, deposit, golf profile
        {
            id: 'checklist', s: 'checklist', k: 'checklist to do todo list',
            q: 'What’s “Your checklist”?',
            a: `<p>Once you’re logged in, the homepage shows <strong>Your checklist</strong> near the top: everything to do before the trip, ticked off as you go.</p>
                <ul>
                <li><strong>RSVP</strong></li>
                <li><strong>Deposit</strong>: pay it on Venmo in a tap</li>
                <li><strong>Handicap</strong> (and GHIN) in your golf profile</li>
                <li><strong>Venmo</strong> username, so the crew can pay you after the trip</li>
                <li><strong>Notifications</strong> on this phone</li>
                </ul>
                <p>The “· 2 to do” link at the top of the homepage jumps to it. Some items unlock once the commissioner approves you, and the checklist goes away when the trip starts.</p>`
        },
        {
            id: 'deposit', s: 'checklist', k: 'deposit pay venmo money',
            q: 'How do I pay my deposit?',
            a: `<p>The deposit is <strong>{deposit}</strong>, due <strong>{depositDue}</strong>, by Venmo to {payTo}.</p>
                <ol>
                <li>In <strong>Your checklist</strong> on the homepage, tap <span class="ui">Pay {deposit} on Venmo</span>. Venmo opens with the amount and a note filled in.</li>
                <li>Check it’s going to the right person, and send it.</li>
                <li>Back on the site, tap <span class="ui">Yes, I sent it</span> (or <span class="ui">I sent it</span>).</li>
                <li>An organizer ticks it off once it shows up in {payTo}’s Venmo. Then your checklist says <strong>Deposit paid</strong>.</li>
                </ol>
                <p class="tip">The site never asks for a card or bank details. Money only moves in Venmo.</p>`
        },
        {
            id: 'deposit-waiting', s: 'checklist', k: 'deposit pending confirm not received undo waiting confirmation',
            q: 'I paid, but it still says “waiting for confirmation”',
            a: `<p>That’s normal: an organizer checks Venmo and confirms it by hand, so it can take a day or so.</p>
                <ul>
                <li><strong>“Not received yet”</strong>: they couldn’t find it. Check your Venmo, and tap <span class="ui">I sent it</span> again once it’s gone through.</li>
                <li>Tapped <span class="ui">I sent it</span> by mistake? Tap <span class="ui">Undo</span>.</li>
                <li>Paid a different amount, or something looks wrong? Text the commissioner.</li>
                </ul>`
        },
        {
            id: 'deposit-no-button', s: 'checklist', k: 'deposit button missing locked approved cant pay',
            q: 'I don’t see a Pay button for the deposit',
            a: `<ul>
                <li><strong>“You can pay your deposit once you’re approved”</strong>: the commissioner hasn’t confirmed you yet.</li>
                <li><strong>“The Pay on Venmo button isn’t ready yet”</strong>: pay {payTo} on Venmo yourself, then tap <span class="ui">I sent it</span>.</li>
                <li><strong>Not logged in?</strong> The cost card says “Log in to pay”. Your checklist only shows once you’re logged in.</li>
                <li>Paid, then found out you can’t make it? Talk to the commissioner about your deposit.</li>
                </ul>`
        },
        {
            id: 'trip-cost', s: 'checklist', k: 'cost price money breakdown how much total',
            q: 'What does the trip cost?',
            a: `<p>The cost card in The Trip section on the homepage shows the estimate per man: golf plus your half of a room, line by line. Flights are extra. Prices can still change; any news shows under <strong>Trip updates</strong>.</p>
                <p>Once the organizers record payments from you, your total so far shows under the cost card.</p>`
        },
        {
            id: 'golf-profile', s: 'checklist', k: 'handicap ghin golf profile edit index',
            q: 'How do I add or change my handicap and GHIN?',
            a: `<p>Open <span class="ui">Golf profile</span> from the menu (or <span class="ui">Edit</span> on Your checklist).</p>
                <ul>
                <li><strong>GHIN number</strong> (optional): 5 to 12 digits, from your GHIN app or club card.</li>
                <li><strong>Handicap</strong>: like 9.4. No official handicap? Give your best guess; the captains can adjust.</li>
                </ul>
                <p>Tap <span class="ui">Save</span>. The captains use these to draft fair teams, and both show on the crew list.</p>`
        },
        {
            id: 'plus-handicap', s: 'checklist', k: 'plus handicap scratch +',
            q: 'How do I enter a plus handicap?',
            a: `<p>Type it with the plus sign, like <strong>+2.1</strong>, or type 2.1 and tick <span class="ui">Plus handicap (+)</span>. Anything from +10 to 54 works.</p>`
        },
        {
            id: 'venmo-handle', s: 'checklist', k: 'venmo username handle add',
            q: 'Why add my Venmo username, and who sees it?',
            a: `<p>So the crew can pay you after the trip: Settle up in The Bookie turns it into a one-tap Venmo button with the amount filled in. Only logged-in, approved players can see it.</p>
                <p>Add it in <span class="ui">Golf profile</span> as @your-username (or paste your Venmo link). <span class="ui">Check it</span> opens your Venmo profile so you can make sure it’s right.</p>`
        },

        // ---- The trip
        {
            id: 'updates', s: 'trip', k: 'news updates announcements still to come latest',
            q: 'Where do I find the latest news?',
            a: `<p><strong>Trip updates</strong>, at the top of The Trip section on the homepage, lists the news newest first. <strong>Still to come</strong> beside it shows what isn’t decided yet. Big news from the commissioner also comes as a notification.</p>`
        },
        {
            id: 'tee-times', s: 'trip', k: 'tee times tba schedule itinerary when',
            q: 'When are tee times posted?',
            a: `<p>As soon as each round is booked. Until then the <a href="/index.html#schedule">schedule</a> says “tee time TBA”. When they’re set you get a “Tee times are posted” notification. All times are {tz} time.</p>`
        },
        {
            id: 'flights', s: 'trip', k: 'flight airport hotel hq room lodging book stay',
            q: 'When should I book my flight, and where are we staying?',
            a: `<p>The <strong>Fly into</strong> card in The Trip section says when to land and when you can fly out. Until the tee times are set it says “Hold off on flights until tee times post”.</p>
                <p>The <strong>HQ</strong> card has the hotel, the nights and a map link.</p>`
        },
        {
            id: 'courses', s: 'trip', k: 'course scorecard yardage photos tees slope rating',
            q: 'Where can I see the courses and scorecards?',
            a: `<p>The <a href="/index.html#courses">Courses</a> section on the homepage has each course’s photos (tap one for full screen), par, yards, rating and slope. Open <strong>Course guide</strong> for the signature holes, likely tees and the full scorecard. Each round on the schedule links to its course.</p>`
        },
        {
            id: 'crew', s: 'trip', k: 'crew head count list attendees who coming',
            q: 'Who’s coming?',
            a: `<p><a href="/index.html#attendees">The Crew</a> on the homepage: everyone who’s in (with handicaps), the waitlist, the probablys, who can’t make it, and who’s up for Sunday. The count at the top of the homepage links there too.</p>`
        },
        {
            id: 'standings', s: 'trip', k: 'standings rankings leaderboard',
            q: 'What’s in Standings?',
            a: `<p>Before the Cup starts, Standings ranks the roster by handicap. Once it’s under way, it shows the official Cup total, both teams and each round’s scores, with a link to <a href="/round_tracker.html#board">Live scores</a>.</p>`
        },
        {
            id: 'teams', s: 'trip', k: 'teams draft captains blue red picked',
            q: 'How are the teams picked?',
            a: `<p>Two captains draft Team Blue and Team Red, using everyone’s handicap to keep it even. That’s why your handicap matters. The captains and formats get posted on the site once they’re set.</p>`
        },
        {
            id: 'trip-days', s: 'trip', k: 'today card trip mode wrap different changed',
            q: 'Why does the homepage look different during the trip?',
            a: `<p>On trip days ({dates}, by the date in {tz}) the top of the homepage turns into a <strong>Today</strong> card: today’s rounds and tee times, with <span class="ui">Live scores</span> and <span class="ui">Keep score</span>. In the evening it adds tomorrow’s first tee time.</p>
                <p>After the trip it becomes <strong>That’s a wrap</strong>: <span class="ui">Final scores</span>, <span class="ui">Settle up</span> and, once the album is set up, <span class="ui">Add your photos</span>.</p>`
        },
        {
            id: 'photos', s: 'trip', k: 'photos album pictures hall of fame add',
            q: 'Where are the photos, and how do I add mine?',
            a: `<p>Past trips’ photos are in the <strong>Hall of Fame</strong> on the homepage; tap one for full screen and swipe through.</p>
                <p>After the trip, the <strong>That’s a wrap</strong> card has <span class="ui">Add your photos</span>, which opens the shared album. You need to be logged in as an approved player to see it.</p>`
        },

        // ---- The Bookie
        {
            id: 'bookie-what', s: 'bookie', k: 'side bets gambling wager who can bet',
            q: 'What is The Bookie, and who can bet?',
            a: `<p>The Bookie is for side bets between the crew: head-to-heads, pools and props. It keeps track of who owes whom, then nets it down to as few Venmos as possible in <a data-topic="settle-up">Settle up</a>. No money moves on the site itself.</p>
                <p>Any approved player who’s logged in can bet; new sign-ups can once the commissioner confirms them. Only approved players can see the bets.</p>`
        },
        {
            id: 'bet-kinds', s: 'bookie', k: 'h2h head to head pool prop types kinds difference',
            q: 'What’s the difference between a head-to-head, a pool and a prop?',
            a: `<ul>
                <li><strong>Head-to-head</strong>: you against one player, for a set amount, at even money or with a line. They have to accept.</li>
                <li><strong>Pool</strong>: everyone puts in the same buy-in, and the winners split the pot.</li>
                <li><strong>Prop</strong>: you bet something happens (“someone makes an ace this trip”). Anyone who takes it is betting it doesn’t. You win or pay the amount to each taker.</li>
                </ul>`
        },
        {
            id: 'make-bet', s: 'bookie', k: 'new bet create post challenge make',
            q: 'How do I make a bet?',
            a: `<ol>
                <li>Tap <span class="ui">+ New bet</span> (on a phone, the round + button at the bottom).</li>
                <li>Pick the kind: <span class="ui">Head-to-Head</span>, <span class="ui">Pool</span> or <span class="ui">Prop bet</span>.</li>
                <li>Spell out the bet clearly, like “Lower gross, Round 1”, and enter the amount in whole dollars.</li>
                <li>For a head-to-head, pick who you’re challenging and the line (<a data-topic="odds">how the line works</a>).</li>
                <li>Check the preview (“You risk $30 to win $20”) and tap <span class="ui">Post bet</span>.</li>
                </ol>
                <p>A pool or prop is open for others to join right away. A challenge waits for the other player to accept.</p>
                <p class="tip">Signal dropped while posting? Tap <span class="ui">Post bet</span> again without changing anything. It won’t post twice.</p>`
        },
        {
            id: 'odds', s: 'bookie', k: 'odds line underdog favorite even 3:2 2:1 custom stake risk',
            q: 'How do the odds (the line) work on a head-to-head?',
            a: `<p><span class="ui">Even</span> means you both risk the same amount. Otherwise one of you is the <strong>underdog</strong> and the other the <strong>favorite</strong>.</p>
                <ul>
                <li>Pick <span class="ui">3:2</span>, <span class="ui">2:1</span> or <span class="ui">Custom</span>, then whether the player you’re challenging is the underdog or the favorite.</li>
                <li>The amount you enter is the <strong>underdog’s stake</strong>. The favorite risks more.</li>
                <li>Example, $20 at 3:2: the underdog risks $20 to win $30, and the favorite risks $30 to win $20.</li>
                <li>Custom odds start at 100: 150 means 3 to 2, and 200 means 2 to 1.</li>
                </ul>
                <p>The preview spells out what each of you risks before you post.</p>`
        },
        {
            id: 'accept-challenge', s: 'bookie', k: 'accept decline challenge your call answer challenged',
            q: 'Someone challenged me. How do I answer?',
            a: `<p>It’s at the top of the board under <strong>Waiting on you</strong>, marked <strong>Your call</strong>. Tap <span class="ui">Accept</span> to make it live, or <span class="ui">Decline</span> to call it off. The confirm shows what you win or pay either way. (On a phone you can also swipe the card left to accept.)</p>`
        },
        {
            id: 'join-pool', s: 'bookie', k: 'join leave pool prop taker buy in',
            q: 'How do I join (or leave) a pool or prop?',
            a: `<p>On the bet’s card, tap <span class="ui">Join pool ($10)</span>, or <span class="ui">Bet it doesn’t ($10)</span> on a prop. Changed your mind? Tap <span class="ui">Leave</span> while betting is still open. Once the creator closes betting, you’re in for good.</p>`
        },
        {
            id: 'record-result', s: 'bookie', k: 'settle result who won close betting push void tie record winner',
            q: 'How do I record who won?',
            a: `<ul>
                <li><strong>A pool or prop you made</strong>: once everyone’s in, tap <span class="ui">Close betting</span>. After the round, tap <span class="ui">Who won?</span>, pick the winner(s) and <span class="ui">Save result</span>.</li>
                <li><strong>A head-to-head</strong>: either player taps <span class="ui">Who won?</span> once it’s decided.</li>
                <li>A tie? <span class="ui">Call it a push</span>. Not happening after all? <span class="ui">Void bet</span>. Either way, no money changes hands.</li>
                <li>A head-to-head on an 18-hole gross score? <span class="ui">Use Live scores (18-hole gross)</span> settles it from the scorecards once you’ve both finished.</li>
                </ul>
                <p>The ledger updates right away, a note in the trash talk shows who recorded it, and everyone on the bet gets a notification.</p>`
        },
        {
            id: 'cancel-bet', s: 'bookie', k: 'cancel delete mistake wrong result reopen undo',
            q: 'How do I cancel a bet, or fix a wrong result?',
            a: `<ul>
                <li><strong>Nobody else is in it yet</strong>: <span class="ui">Cancel bet</span> on the card takes it off the board.</li>
                <li><strong>Already accepted</strong>: tap <span class="ui">Who won?</span>, then <span class="ui">Void bet</span>. The creator of an open pool or prop can also tap <span class="ui">Cancel bet</span>: everyone who joined is out and owes nothing.</li>
                <li><strong>Wrong result saved</strong>: ask the commissioner. Organizers can reopen a settled bet so it can be recorded again.</li>
                </ul>`
        },
        {
            id: 'waiting-on-you', s: 'bookie', k: 'badge red count needs you your call needs a result number',
            q: 'What do “Waiting on you” and the red number mean?',
            a: `<p>A bet needs something from you: a challenge to answer, or a pool or prop you made that needs its result. Those go to the top of the board under <strong>Waiting on you</strong>, and the red number on the Bookie link (and a dot on the menu button) counts them. After the trip, your live head-to-heads count too, until someone records who won.</p>`
        },
        {
            id: 'bookie-tabs', s: 'bookie', k: 'tabs filters my bets past trips board refresh',
            q: 'What are the tabs on the board, and Past Trips?',
            a: `<ul>
                <li><strong>All bets</strong>, <strong>Pools &amp; Props</strong>, <strong>Head-to-Head</strong>, <strong>My Bets</strong>: different views of this trip’s bets. On a phone, use the bar at the bottom.</li>
                <li><strong>Past Trips</strong>: bets from earlier trips. They don’t count in this year’s ledger.</li>
                </ul>
                <p>Pull down (or tap <span class="ui">Refresh</span>) for the latest. The board doesn’t update while you watch.</p>`
        },
        {
            id: 'trash-talk', s: 'bookie', k: 'comments trash talk chat smack',
            q: 'How does Trash Talk work?',
            a: `<p>Every bet has a <strong>Trash Talk</strong> thread: open it, type, and tap <span class="ui">Post</span> (up to 280 characters). Everyone else on that bet gets a notification. Results, cancels and reopens leave a note there too.</p>`
        },
        {
            id: 'text-about-it', s: 'bookie', k: 'notify text link share challenge know',
            q: 'Does the other player know I challenged them?',
            a: `<p>If they have notifications on, their phone gets one right away, and the message after you post says so. If not, tap <span class="ui">Text … about it</span> on the card. It writes a text with a link that opens the bet, even if they have to log in first.</p>`
        },

        // ---- Settle up
        {
            id: 'settle-up', s: 'settle', k: 'settle up pay owe ledger netting netted',
            q: 'How does Settle up work?',
            a: `<p>Open <a href="/bookie.html#ledger-panel">the Ledger</a> in The Bookie (on a phone, the Ledger tab at the bottom; after the trip, <span class="ui">Settle up</span> on the homepage).</p>
                <ul>
                <li>Every settled bet adds up to one net per player: up, down or even. Tap a name to see the bets behind it.</li>
                <li><strong>Settle up</strong> lists who pays whom. It’s <strong>netted</strong> to keep the number of Venmos down, so you might pay someone you never bet with, but every total comes out right.</li>
                </ul>
                <p>Rather pay bet by bet? Tap <span class="ui">Show bet-by-bet payments</span>.</p>`
        },
        {
            id: 'pay-venmo', s: 'settle', k: 'venmo pay request mark paid got it undo',
            q: 'How do I pay, or get paid, for bets?',
            a: `<ol>
                <li>In Settle up, find your line, like “You → [name] $20”.</li>
                <li>Tap <span class="ui">Pay $20 on Venmo</span>. Venmo opens with the amount filled in. Check it’s the right person, and pay.</li>
                <li>Tap <span class="ui">Mark paid</span>, so it comes off the list for both of you.</li>
                </ol>
                <p>Getting paid? <span class="ui">Request on Venmo</span> asks for it, and <span class="ui">Got it</span> marks it once the money arrives. Either of you can mark it, and either can <span class="ui">Undo</span> it from the Paid list.</p>
                <p>No Venmo button? That player hasn’t added a Venmo username yet. <span class="ui">Copy for the group text</span> copies the whole list to paste in the group chat.</p>`
        },
        {
            id: 'your-net', s: 'settle', k: 'net total collect pay squared up even',
            q: 'What does “Your net” mean?',
            a: `<p>Your total across every settled bet this trip: <strong>+$</strong> means you’re up, <strong>−$</strong> means you’re down. As payments get marked paid it adds “$X to collect”, “$X to pay” or “squared up”. Tap it to jump to the Ledger.</p>
                <p>Only settled bets count. A live bet doesn’t, until someone records who won.</p>`
        },
        {
            id: 'never-settled', s: 'settle', k: 'past trips never settled last year old bets',
            q: 'What about bets from last year?',
            a: `<p>They’re under <strong>Past Trips</strong>. Ones nobody finished say “Never settled” or “Never answered”, and no money changes hands on them. Last year’s settled bets have their own final ledger and settle up there, for anyone still holding out.</p>`
        },

        // ---- Keep score
        {
            id: 'who-scores', s: 'score', k: 'keep score scorekeeper permission one phone per group allowed',
            q: 'Who keeps score, and who’s allowed to?',
            a: `<p><strong>One phone per group.</strong> Any approved player who’s logged in can keep score.</p>
                <ul>
                <li>Not logged in? Tap <span class="ui">Log in to keep score</span>.</li>
                <li>Still waiting for approval? You can’t keep score yet, but you can follow <a href="/round_tracker.html#board">Live scores</a>.</li>
                <li>“Your login isn’t linked to your name”? Open The Bookie, pick your name, then come back.</li>
                </ul>`
        },
        {
            id: 'start-round', s: 'score', k: 'start scoring round setup match group begin',
            q: 'How do I start scoring our round?',
            a: `<ol>
                <li>Open <a href="/round_tracker.html#setup">Keep score</a> (on the homepage, in the menu, or /score) <strong>while you still have signal</strong>, ideally before you tee off.</li>
                <li>Today’s round and course are already picked. Check them.</li>
                <li>Tap your <strong>match</strong>. Playing as a foursome of two singles matches? Tap the other one too. Or use <span class="ui">Pick players one by one</span>.</li>
                <li>Tap <span class="ui">Start scoring Round 1</span> (or whichever round it is).</li>
                </ol>
                <p>If another group already started the round, you join it, and any holes already entered for your group fill in.</p>
                <p class="tip">“Start it today anyway?” means that round isn’t on today’s schedule. Tap Cancel unless the plan changed.</p>`
        },
        {
            id: 'enter-scores', s: 'score', k: 'enter score stepper plus minus keypad next hole',
            q: 'How do I enter scores?',
            a: `<ul>
                <li>Each player has <strong>− score +</strong>. On an empty hole, <strong>+</strong> puts in par and <strong>−</strong> a birdie; then tap to adjust.</li>
                <li>Or tap the score itself for a keypad from 1 to 10.</li>
                <li>When every score on the hole is in, a <strong>Hole 2 →</strong> bar appears at the bottom, and the › at the top turns gold. The bar ignores taps for a moment, so a quick double tap can’t skip a hole.</li>
                <li>Use ‹ and ›, or the hole numbers 1 to 18, to jump around.</li>
                </ul>
                <p>In the Split Decision, partners share one row: one score for the team.</p>`
        },
        {
            id: 'picked-up', s: 'score', k: 'picked up pick up max triple bogey zero points',
            q: 'What do I enter when someone picks up?',
            a: `<ul>
                <li><strong>The Grind (team points)</strong>: tap the score and choose <span class="ui">Picked up (0 pts)</span>. It enters a double bogey, which is 0 points either way.</li>
                <li><strong>The Split Decision</strong>: the max is triple bogey, so the + stops there. Pick up and take the triple.</li>
                </ul>`
        },
        {
            id: 'fix-score', s: 'score', k: 'fix correct edit mistake change wrong score clear',
            q: 'How do I fix a score I got wrong?',
            a: `<p>Go back to the hole (‹, or tap its number in the strip), or open <strong>Card</strong> and tap the score. Change it and it saves. To empty a box, tap the score and choose <span class="ui">Clear this score</span>.</p>`
        },
        {
            id: 'tracker-marks', s: 'score', k: 'gold dot green circle square birdie bogey card marks colors legend',
            q: 'What do the colors, dots and marks mean?',
            a: `<ul>
                <li><strong>Hole numbers</strong>: green means scored, a small gold dot underneath means partly scored, and a gold ring is the hole you’re on.</li>
                <li><strong>A gold dot on a score</strong>: saved on this phone but not sent yet. It keeps trying (<a data-topic="no-signal">no signal?</a>).</li>
                <li><strong>On the Card</strong>: circle = birdie, double circle = eagle or better, square = bogey, double square = double bogey or worse. No mark = par.</li>
                <li><strong>The lines above the players</strong>: how each match stands, like “Match 1 — Blue leads 14–10 pts thru 6”.</li>
                </ul>`
        },
        {
            id: 'resume', s: 'score', k: 'closed app resume lost phone died battery dead',
            q: 'I closed the app (or my phone died). Did I lose the round?',
            a: `<p>No. The round is saved on your phone: open Keep score again and it picks up at the same hole.</p>
                <p>Phone dead? Someone else in the group can open Keep score, pick the same match and start. Every score that reached the database fills in (“Holes 1–7 are already in”). Anything the dead phone hadn’t sent goes up once it’s charged and Keep score is opened again.</p>`
        },
        {
            id: 'done-scoring', s: 'score', k: 'done finish end round hand off change group',
            q: 'How do I finish, or hand scoring to another phone?',
            a: `<p>Open <strong>Card</strong> and tap <span class="ui">Done scoring on this phone</span>. It only stops this phone; the round stays open for everyone else. If it says scores are still sending, keep the page open until it says <strong>All saved</strong>.</p>
                <p>To score a different group, tap <span class="ui">Change group</span> under the scores. Everything already entered stays saved.</p>`
        },
        {
            id: 'two-phones', s: 'score', k: 'two phones duplicate another phone same group',
            q: 'It says another phone is scoring this group too',
            a: `<p>Two phones are entering scores for the same players. Agree on one scorekeeper, and on the other phone open <strong>Card</strong> and tap <span class="ui">Done scoring on this phone</span>.</p>`
        },
        {
            id: 'practice-round', s: 'score', k: 'practice round thursday sunday no points not tracked',
            q: 'Do we keep score in the practice round, or on Sunday?',
            a: `<p>No. Only Cup rounds are tracked. The practice round earns no Cup points and Keep score doesn’t record it, so the homepage hides Keep score on days without a Cup round. Keep your own card those days.</p>`
        },

        // ---- No signal
        {
            id: 'no-signal', s: 'signal', k: 'offline no signal dead zone saved lost connection',
            q: 'What happens if I lose signal on the course?',
            a: `<p>Keep scoring. Every score is saved on your phone first, then sent as soon as there’s signal. Nothing is lost in a dead zone.</p>
                <p>The one thing that needs signal is <strong>starting</strong> the round, so tap Start before you head out.</p>
                <p>The note at the top right says where things stand: <a data-topic="sync-status">what it means</a>.</p>`
        },
        {
            id: 'sync-status', s: 'signal', k: 'all saved saving waiting for signal not saved log in to send sync status',
            q: 'What do “All saved”, “waiting for signal” and “Log in to send” mean?',
            a: `<ul>
                <li><strong>✓ All saved</strong>: every score is in the database.</li>
                <li><strong>Saving 2 scores…</strong>: on its way.</li>
                <li><strong>2 scores waiting for signal</strong>: saved on this phone. They send by themselves when the signal’s back.</li>
                <li><strong>Log in to send 2 scores</strong>: your login ran out. Tap it, log in, and they send.</li>
                <li><strong>2 scores not saved: …</strong> (in red): the database turned them down. Tell an organizer.</li>
                </ul>`
        },
        {
            id: 'keep-open', s: 'signal', k: 'close app background switch apps lock phone',
            q: 'Can I close Keep score, or switch apps?',
            a: `<p>Yes: switch apps, lock the phone, even close it. Unsent scores stay on the phone and send the next time Keep score is open with signal. At the end of the round, though, keep it open until it says <strong>All saved</strong> so Live scores is complete.</p>`
        },
        {
            id: 'offline-open', s: 'signal', k: 'offline reopen cached no internet airplane',
            q: 'Can I open the site with no signal at all?',
            a: `<p>Keep score, yes, as long as you’ve opened it on this phone before (with signal): the phone keeps a copy. Live scores shows the last scores it loaded, with a note that it couldn’t update. The rest of the site needs signal.</p>`
        },

        // ---- Live scores
        {
            id: 'live-where', s: 'live', k: 'live scores leaderboard board watch follow refresh',
            q: 'Where do I follow live scores?',
            a: `<p><a href="/round_tracker.html#board">Live scores</a>: at the top of the homepage during the trip, in the menu on The Bookie, Rules and Messages, or at /live. No login needed, so anyone can follow along. It refreshes itself every 45 seconds, or tap <span class="ui">Refresh</span>.</p>`
        },
        {
            id: 'live-read', s: 'live', k: 'if it ended now banked points on the line up all square dormie thru projection',
            q: 'How do I read Live scores?',
            a: `<ul>
                <li><strong>If it ended now: Blue 6 – 4 Red</strong>: each match goes to whoever leads right now, and a level match counts ½ each.</li>
                <li><strong>Banked so far</strong>: points from finished matches, then how many points are still on the line.</li>
                <li><strong>Match cards</strong>: “2 UP thru 7”, “All square”, “dormie” (up as many holes as are left), “wins 3&amp;2” (3 up with 2 to play). Points rounds read like “Blue leads 14–10 pts thru 6”. In the Split Decision each nine is scored on its own.</li>
                <li>Your match is marked <strong>yours</strong> and comes first.</li>
                </ul>`
        },
        {
            id: 'live-table', s: 'live', k: 'individual table ranking pts to par thru F T2 standings',
            q: 'How is the player table ranked?',
            a: `<p>In a points round (The Grind), by points against par pace, so groups that teed off later aren’t buried. Otherwise by score to par. <strong>Thru</strong> is holes played (<strong>F</strong> = finished), and <strong>T2</strong> means tied for 2nd. All scores are gross.</p>`
        },
        {
            id: 'official-cup', s: 'live', k: 'official cup total commissioner score',
            q: 'Is Live scores the official Cup score?',
            a: `<p>Not quite. Live scores is built from the groups’ scorecards as they’re entered. The <strong>official</strong> Cup total is posted by the commissioner after each session. Once the Cup is under way it shows as “The Cup (official)” on Live scores, and in Standings and on the homepage.</p>`
        },

        // ---- Rules
        {
            id: 'handicap-strokes', s: 'rules', k: 'handicap strokes net gross',
            q: 'Do we play with handicap strokes?',
            a: `<p>No. Every match is straight up, gross. Handicaps are only used to draft even teams.</p>`
        },
        {
            id: 'house-rules', s: 'rules', k: 'desert penalty water hazard lost ball out of bounds ob drop',
            q: 'What’s the rule for the desert, water, lost balls and OB?',
            a: `<ul>
                <li><strong>Desert</strong>: it’s a penalty area. Drop outside it, within two club-lengths of where the ball crossed in, no closer to the hole: <strong>1 stroke</strong>. A ball lost in the desert is the same.</li>
                <li><strong>Water</strong>: same as the desert, 1 stroke.</li>
                <li><strong>Lost ball or out of bounds</strong> anywhere else: drop within two club-lengths of where it was lost or went out, no closer to the hole: <strong>2 strokes</strong>. No walking back to the tee.</li>
                </ul>
                <p><a href="/rules.html#house-rules">The house rules on the rules page</a></p>`
        },
        {
            id: 'gimme', s: 'rules', k: 'gimme leather putt conceded',
            q: 'What counts as a gimme?',
            a: `<p>Anything inside the leather of your putter: add one stroke, no putt needed. But if you putt it anyway and miss, that stroke counts and the gimme’s gone. <a href="/rules.html#gimme">The gimme rule</a></p>`
        },
        {
            id: 'formats', s: 'rules', k: 'format grind split decision singles scramble alternate shot match play points',
            q: 'What are the formats, and how is each scored?',
            a: `<ul>
                <li><a href="/rules.html#grind"><strong>The Grind</strong></a>: two-man teams, each player on their own ball. Points per player per hole: eagle 5, birdie 3, par 2, bogey 1, worse 0. Most team points wins the match.</li>
                <li><a href="/rules.html#split"><strong>The Split Decision</strong></a>: front 9 scramble, back 9 alternate shot. One team score per hole, triple-bogey max, and each nine is worth a point.</li>
                <li><a href="/rules.html#singles"><strong>Championship Singles</strong></a>: one on one, match play.</li>
                </ul>
                <p>The format line at the top of Keep score and Live scores links to the full rules for that round. Formats can change from year to year; the <a href="/rules.html">rules page</a> has the latest.</p>`
        },
        {
            id: 'win-cup', s: 'rules', k: 'cup win points tie playoff putting how many',
            q: 'How many points win the Cup, and what if it’s tied?',
            a: `<p>The rules page’s <a href="/rules.html#singles">Path to the Cup</a> adds up the points on offer and how many it takes to win. If the teams are tied after the last Cup round, a <a href="/rules.html#playoff">team putting contest</a> decides it, then sudden death.</p>`
        },

        // ---- Messages
        {
            id: 'messages-how', s: 'messages', k: 'message dm direct chat text send',
            q: 'How do I message another player?',
            a: `<p>Open <a href="/messages.html">Messages</a> from the menu (or the header of The Bookie), tap <span class="ui">New message</span> and find the player. Type, then tap <span class="ui">Send</span>. If they have notifications on, their phone gets one.</p>
                <p>You can message any approved player who has set up their account. If someone can’t get messages yet, it says so instead of showing the message box.</p>`
        },
        {
            id: 'messages-unsend', s: 'messages', k: 'unsend delete seen read receipt',
            q: 'Can I unsend a message? Can they tell I read theirs?',
            a: `<p>Tap <span class="ui">Unsend</span> under any message you sent. It disappears for both of you (though a banner already on their phone stays).</p>
                <p>When they’ve read your latest message, “Seen” shows under it. They see the same for you.</p>`
        },
        {
            id: 'messages-limits', s: 'messages', k: 'limit slow down didnt send rate',
            q: 'It said “Slow down a little”, or my message didn’t send',
            a: `<p>Messages are capped at 10 a minute and 300 a day, up to 1,000 characters each. If it says “Didn’t send”, your text stays in the box: check your signal and tap <span class="ui">Send</span> again.</p>`
        },
        {
            id: 'messages-locked', s: 'messages', k: 'messages locked cant open approve',
            q: 'Why can’t I open Messages?',
            a: `<ul>
                <li><strong>“Log in to message the crew”</strong>: log in first.</li>
                <li><strong>“Your login isn’t linked to a player yet”</strong>: pick your name in The Bookie.</li>
                <li><strong>“Messages open once the commissioner approves you”</strong>: new players can message once they’re approved.</li>
                </ul>`
        },
        {
            id: 'messages-private', s: 'messages', k: 'private messages read organizers',
            q: 'Can the organizers read my messages?',
            a: `<p>No. Only you and the other player can see a conversation. The site gives the organizers no way to read them.</p>`
        },

        // ---- Notifications and the app
        {
            id: 'home-screen', s: 'alerts', k: 'install app home screen add to home screen icon iphone android',
            q: 'How do I put the site on my home screen like an app?',
            a: `<ul>
                <li><strong>iPhone</strong>: open the site in <strong>Safari</strong>, tap <strong>Share</strong> (the square with the arrow), then <strong>Add to Home Screen</strong>.</li>
                <li><strong>Android</strong>: in <strong>Chrome</strong>, open the ⋮ menu and tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</li>
                </ul>
                <p>Or tap <span class="ui">Install</span> on Your checklist or in the bell when your phone offers it. Then open it from the new icon. On an iPhone, log in once inside the app.</p>`
        },
        {
            id: 'notifications-on', s: 'alerts', k: 'push notifications alerts turn on enable banners phone',
            q: 'How do I turn on notifications on my phone?',
            a: `<ol>
                <li><strong>iPhone</strong>: first <a data-topic="home-screen">add the site to your home screen</a> and open it from there. A Safari tab can’t get notifications.</li>
                <li>Log in, tap the <strong>bell</strong> at the top right, then <span class="ui">Turn on</span>, and <strong>Allow</strong> when your phone asks.</li>
                <li>Tap <span class="ui">Send a test</span>. A banner should pop up in a few seconds.</li>
                </ol>
                <p>It’s per phone, so do it on each one you use. <span class="ui">Turn on notifications</span> on Your checklist does the same thing. You need to be an approved player.</p>`
        },
        {
            id: 'notifications-what', s: 'alerts', k: 'what notifications kinds types get',
            q: 'What will I get notified about?',
            a: `<ul>
                <li>A challenge sent to you, and when yours is accepted or declined</li>
                <li>Betting closing, results, pushes and reopens on bets you’re in, and trash talk on them</li>
                <li>Someone marking a payment between you as paid</li>
                <li>Tee times posted</li>
                <li>A player who’s in for the trip (tap to say hello), and a spot opening up for you off the waitlist</li>
                <li>Your approval, and the commissioner’s announcements</li>
                <li>New messages</li>
                </ul>
                <p>Never for something you did yourself. They all land in the bell, phone notifications on or not.</p>`
        },
        {
            id: 'bell', s: 'alerts', k: 'bell notifications list badge count',
            q: 'What’s the bell at the top?',
            a: `<p>Your notifications. The number is how many are new. Tap it for the list, newest first (then <span class="ui">Show older</span>), and tap one to open what it’s about.</p>
                <p>The bell is also where you turn this phone’s notifications on or off and <span class="ui">Send a test</span>. It shows once you’re logged in as an approved player.</p>`
        },
        {
            id: 'notifications-trouble', s: 'alerts', k: 'blocked denied not working test didnt arrive focus do not disturb',
            q: 'It says notifications are blocked, or the test never arrives',
            a: `<ul>
                <li><strong>Blocked</strong>: you tapped Don’t Allow at some point. Turn them back on in your phone’s <strong>Settings → Notifications</strong>: find the app and allow notifications. On Android, also check Chrome’s settings for this site.</li>
                <li><strong>The test didn’t show</strong>: make sure Focus or Do Not Disturb is off and, on an iPhone, that you opened the site from its home-screen icon, not Safari.</li>
                <li>You can send 3 tests every 10 minutes.</li>
                </ul>
                <p>Whatever the phone does, everything still shows in the bell.</p>`
        },
        {
            id: 'notifications-off', s: 'alerts', k: 'turn off stop disable mute',
            q: 'How do I turn notifications off?',
            a: `<p>Tap the bell, then <span class="ui">Turn off</span>. That stops banners on this phone only, and you still see everything in the bell.</p>`
        },

        // ---- Privacy
        {
            id: 'privacy-who', s: 'privacy', k: 'privacy public private visible email ghin who sees',
            q: 'Who can see my information?',
            a: `<ul>
                <li><strong>Anyone with the link</strong>: names, GHIN numbers and handicaps, teams, the head count, schedule and tee times, and scores.</li>
                <li><strong>Approved players who are logged in</strong>: bets, results and trash talk, Venmo usernames, Paid marks and the photo album link.</li>
                <li><strong>Only you and the organizers</strong>: your email, your RSVP note and your payments.</li>
                <li><strong>Only you and the other player</strong>: your messages.</li>
                </ul>
                <p>The full details are on the <a href="/privacy.html">privacy page</a>.</p>`
        },
        {
            id: 'privacy-change', s: 'privacy', k: 'delete account remove data change info',
            q: 'How do I change or delete my information?',
            a: `<p>Change your GHIN, handicap and Venmo in <span class="ui">Golf profile</span>, and unsend any message you sent. For anything else, or to delete your account, email <a href="mailto:{inbox}">{inbox}</a>.</p>`
        },

        // ---- Something's not working
        {
            id: 'being-set-up', s: 'trouble', k: 'being set up not ready coming soon',
            q: 'It says something is “being set up”',
            a: `<p>That part of the site isn’t switched on yet. Check back soon, or text the commissioner if it’s holding you up.</p>`
        },
        {
            id: 'page-trouble', s: 'trouble', k: 'not loading broken refresh stuck old spinner couldnt reach ad blocker',
            q: 'A page won’t load, or looks out of date',
            a: `<ul>
                <li><strong>Refresh</strong>: reload the page, or in the home-screen app, close it and open it again.</li>
                <li><strong>Check your signal.</strong> “Couldn’t load…” usually means the phone couldn’t reach the site. Try again with a bar or two.</li>
                <li><strong>“Couldn’t reach the login service”</strong>: turn off any strict ad or content blocker for this site, then refresh.</li>
                <li>Stuck on “One sec, checking your login…”? Refresh the page.</li>
                </ul>`
        },
        {
            id: 'wrong-player', s: 'trouble', k: 'wrong name wrong player logged in as someone else',
            q: 'The site thinks I’m someone else',
            a: `<p>Someone else may have logged in on this phone. Open the menu: it says who’s signed in. Tap <span class="ui">Log out</span> and log in as you. If your login is linked to the wrong roster name, text the commissioner to unlink it.</p>`
        },
        {
            id: 'not-admin', s: 'trouble', k: 'admin not admin commissioner login',
            q: 'Admin says my login isn’t an admin',
            a: `<p>Admin is only for the organizers. Everything a player does is on the homepage, The Bookie and Keep score. Tap <span class="ui">← Back to the site</span>.</p>`
        },
        {
            id: 'contact', s: 'trouble', k: 'contact help commissioner email organizer stuck ask',
            q: 'Who do I ask if I’m stuck?',
            a: `<p>Text the commissioner, or ask in the group text. You can also email <a href="mailto:{inbox}">{inbox}</a>.</p>`
        },

        // ---- Admin
        {
            id: 'admin-what', s: 'admin', k: 'admin tabs organizer dashboard',
            q: 'What’s in Admin?',
            a: `<p>Admin is for the organizers, with the same login as everything else. Logged in as an organizer, the homepage menu shows an <strong>Admin</strong> link (or go to /admin).</p>
                <ul>
                <li><strong>Roster</strong>: players, handicaps, teams and Venmo.</li>
                <li><strong>RSVPs</strong>: every answer and note, approvals, deposits to confirm, payments, the invite link and a CSV.</li>
                <li><strong>Draft</strong> and <strong>Matchups</strong>: the teams and each round’s matches.</li>
                <li><strong>Cup total</strong> and <strong>Scores</strong>: the official Cup points and each player’s scores.</li>
                <li><strong>New sign-ups</strong>, <strong>Photos</strong>, <strong>Tee times</strong> and <strong>Announce</strong>.</li>
                </ul>`
        },
        {
            id: 'admin-approve', s: 'admin', k: 'approve new player sign-up confirm claimed name check login',
            q: 'How do I approve a new sign-up?',
            a: `<p>On the <strong>RSVPs</strong> tab, tap <span class="ui">Approve</span> next to the player. It’s instant, and <span class="ui">Let him know</span> drafts an email. On <strong>New sign-ups</strong>, Approve takes effect when you press <span class="ui">Save Changes</span>.</p>
                <p><strong>Claimed name</strong> or <strong>Check login</strong> means someone picked a roster name with a different email from the one on file. Check the login shown, then press <span class="ui">Approve this login</span> or <span class="ui">Not him</span>.</p>`
        },
        {
            id: 'admin-deposits', s: 'admin', k: 'deposit confirm received venmo claim',
            q: 'How do I confirm a deposit?',
            a: `<p>Players who tap “I sent it” show up on the <strong>RSVPs</strong> tab under <strong>Deposits to confirm</strong>. Check {payTo}’s Venmo, then tap <span class="ui">Confirm</span> (check the amount and date) or <span class="ui">Not received</span>.</p>
                <p>Confirm records the payment and ticks the player’s checklist. Not received asks them to check, and to tap I sent it again once it goes through.</p>`
        },
        {
            id: 'admin-tee-times', s: 'admin', k: 'tee times announcement notify everyone announce',
            q: 'How do I post tee times or send an announcement?',
            a: `<ul>
                <li><strong>Tee times</strong>: set each round’s time, plus an optional note like “4 groups, 10 min apart”. It shows on the homepage schedule right away, and everyone gets a notification.</li>
                <li><strong>Announce</strong>: a title and an optional message go to every approved player’s bell, and pop up on the phones that have notifications on. Bets, tee times, approvals and new RSVPs already notify on their own.</li>
                </ul>`
        },
        {
            id: 'admin-scores', s: 'admin', k: 'score entry fill from round tracker cup total official',
            q: 'How do the official scores get in?',
            a: `<ul>
                <li><strong>Scores</strong>: pick the round, press <span class="ui">Fill from Round Tracker</span> to copy the groups’ scorecards, check them, then save.</li>
                <li><strong>Cup total</strong>: type each team’s official points and press <span class="ui">Save Scores</span>. That’s the number the homepage and Standings show as official.</li>
                </ul>`
        },
        {
            id: 'admin-album', s: 'admin', k: 'photo album google photos icloud link shared',
            q: 'How do I set up the shared photo album?',
            a: `<p>Make a shared album (Google Photos with Collaborate on, or an iCloud Shared Album with Public Website on), copy its link and paste it on the <strong>Photos</strong> tab. After the trip, approved players who are logged in get <span class="ui">Add your photos</span> on the homepage.</p>`
        }
    ];

    // The handful each page shows first, most useful first
    const PAGE_TOPICS = {
        home: ['first-steps', 'rsvp-how', 'checklist', 'deposit', 'spots', 'golf-profile', 'notifications-on', 'home-screen', 'tee-times', 'whats-here'],
        bookie: ['bookie-what', 'make-bet', 'odds', 'accept-challenge', 'record-result', 'settle-up', 'pay-venmo', 'waiting-on-you', 'cancel-bet', 'approval'],
        'bookie#ledger-panel': ['settle-up', 'pay-venmo', 'your-net', 'venmo-handle', 'never-settled', 'record-result'],
        tracker: ['start-round', 'enter-scores', 'no-signal', 'sync-status', 'fix-score', 'picked-up', 'tracker-marks', 'done-scoring', 'live-read'],
        'tracker#setup': ['who-scores', 'start-round', 'practice-round', 'no-signal', 'enter-scores', 'formats'],
        'tracker#score': ['enter-scores', 'picked-up', 'fix-score', 'tracker-marks', 'sync-status', 'no-signal', 'two-phones', 'done-scoring'],
        'tracker#card': ['tracker-marks', 'fix-score', 'done-scoring', 'sync-status'],
        'tracker#board': ['live-where', 'live-read', 'live-table', 'official-cup', 'formats', 'offline-open'],
        messages: ['messages-how', 'messages-unsend', 'messages-limits', 'messages-locked', 'messages-private', 'notifications-on'],
        rules: ['handicap-strokes', 'house-rules', 'gimme', 'formats', 'win-cup', 'teams'],
        privacy: ['privacy-who', 'privacy-change', 'messages-private', 'notifications-off'],
        admin: ['admin-what', 'admin-approve', 'admin-deposits', 'admin-tee-times', 'admin-scores', 'admin-album', 'not-admin'],
        lost: ['find-things', 'short-links', 'page-trouble', 'contact']
    };

    // ---- year-by-year facts, from trip-config.js -------------------------------------------------
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function shortDate(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
        return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : (value ? String(value) : '');
    }
    function money(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return '';
        return '$' + (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2));
    }
    function facts() {
        const B = window.BBB || {};
        const trip = B.trip || {};
        const pay = (trip.cost && trip.cost.payment) || {};
        const rsvp = B.rsvp || {};
        return {
            spots: rsvp.spots ? String(rsvp.spots) : 'all the',
            rsvpBy: shortDate(rsvp.lockBy) || 'the RSVP date',
            deposit: money(pay.amount) || 'the deposit',
            depositDue: shortDate(pay.due) || 'the due date',
            payTo: pay.payTo || 'the organizer collecting it',
            dates: (trip.dates && trip.dates.label) || 'the trip dates',
            tz: trip.timeZoneName || 'trip',
            inbox: (B.alerts && B.alerts.to) || 'brosbeforeboges@lokdit.net',
            host: location.host || 'the site'
        };
    }
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function fill(html) {
        const f = facts();
        return String(html).replace(/\{(\w+)\}/g, (all, key) => (key in f ? esc(f[key]) : all));
    }

    // ---- which page is this? ---------------------------------------------------------------------
    const script = document.currentScript;
    const PAGE_NAMES = {
        home: 'the homepage', bookie: 'The Bookie', tracker: 'Keep score & Live scores',
        messages: 'Messages', rules: 'the rules', privacy: 'the privacy page', admin: 'Admin', lost: 'this page'
    };
    function pageKey() {
        const forced = script && script.dataset && script.dataset.page;
        if (forced) return forced;
        const last = location.pathname.split('/').pop().replace(/\.html$/i, '').toLowerCase();
        return ({
            '': 'home', index: 'home', bookie: 'bookie', signup: 'bookie', round_tracker: 'tracker',
            messages: 'messages', rules: 'rules', privacy: 'privacy', admin: 'admin', help: 'help'
        })[last] || 'home';
    }
    // The organizers' answers show only on Admin itself
    function shown(t) {
        const sec = SECTIONS.find(s => s.id === t.s);
        return !(sec && sec.organizers) || pageKey() === 'admin';
    }
    // This page's picks: its open tab's list (#score, #ledger-panel, …) when it has one
    function pageTopics(page) {
        const hash = decodeHash(location.hash.slice(1));
        const ids = (hash && PAGE_TOPICS[`${page}#${hash}`]) || PAGE_TOPICS[page] || [];
        return ids.map(id => TOPICS.find(t => t.id === id)).filter(Boolean);
    }
    function decodeHash(h) {
        try { return decodeURIComponent(h); } catch (e) { return h; }
    }

    // ---- search ----------------------------------------------------------------------------------
    const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[’‘]/g, "'").replace(/[^a-z0-9'$#+½ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const plain = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
    const sectionTitle = id => (SECTIONS.find(s => s.id === id) || {}).title || '';
    let index = null;
    function searchIndex() {
        if (!index) {
            index = TOPICS.filter(shown).map(t => ({ t, q: norm(t.q), k: norm(t.k), a: norm(plain(fill(t.a))) }));
        }
        return index;
    }
    // Every word has to turn up somewhere (the start of a word counts: "settl" finds "settle up").
    // An answer whose question or search words have every word is a strong hit; one that only
    // mentions them in passing is a weak one. Strong hits come first, best first.
    function searchHits(query) {
        const words = norm(query).split(' ').map(w => w.replace(/^'+|'+$/g, '')).filter(Boolean);
        if (!words.length) return [];
        const hits = [];
        searchIndex().forEach((row, i) => {
            let score = 0, strong = true;
            for (const w of words) {
                const safe = w.replace(/[$+#]/g, '\\$&');
                const re = new RegExp('(^|[^a-z0-9])' + safe);
                const inQ = re.test(row.q), inK = re.test(row.k), inA = re.test(row.a);
                if (!inQ && !inK && !inA) return;
                if (!inQ && !inK) strong = false;
                // The whole word in the question beats the start of a longer one ("score", not "scorecards")
                const whole = new RegExp('(^|[^a-z0-9])' + safe + '($|[^a-z0-9])').test(row.q);
                score += (inQ ? 6 : 0) + (whole ? 2 : 0) + (inK ? 3 : 0) + (inA ? 1 : 0);
            }
            hits.push({ t: row.t, strong, score, i });
        });
        return hits.sort((x, y) => (y.strong - x.strong) || y.score - x.score || x.i - y.i);
    }
    const search = query => searchHits(query).map(h => h.t);

    // ---- building blocks -------------------------------------------------------------------------
    function node(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = String(text);
        return n;
    }
    const CHEV = '<svg class="bbb-help-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const QMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.4 8a4.6 4.6 0 1 1 8.58 2.3C14.8 12 12 12.8 12 15.4"/><path d="M12 20.4h.01"/></svg>';
    const LENS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

    // One answer: a question that opens to its answer. opts.where adds the section's name under the
    // question (search results); opts.id gives it an id (the help page)
    function topicEl(t, opts = {}) {
        const d = node('details', 'bbb-help-topic');
        d.dataset.topic = t.id;
        if (opts.id) d.id = t.id;
        const s = node('summary');
        const q = node('span', 'bbb-help-q', t.q);
        if (opts.where) q.appendChild(node('span', 'bbb-help-where', sectionTitle(t.s)));
        s.appendChild(q);
        s.insertAdjacentHTML('beforeend', CHEV);
        const a = node('div', 'bbb-help-a');
        a.innerHTML = fill(t.a);
        a.querySelectorAll('a[data-topic]').forEach(link => {
            link.setAttribute('href', (opts.page ? '#' : '/help.html#') + link.dataset.topic);
        });
        d.append(s, a);
        return d;
    }
    function listOf(topics, opts) {
        const ul = node('ul', 'bbb-help-list');
        topics.forEach(t => {
            const li = node('li');
            li.appendChild(topicEl(t, opts));
            ul.appendChild(li);
        });
        return ul;
    }

    // ---- the ? button and its panel --------------------------------------------------------------
    let button = null;
    let overlay = null;
    let panel = null;
    let els = {};
    let lastFocus = null;

    function placeButton() {
        button = node('button', 'bbb-help');
        button.type = 'button';
        button.id = 'bbb-help-btn';
        button.setAttribute('aria-label', 'Help');
        button.setAttribute('title', 'Help');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'bbb-help-panel');
        button.innerHTML = QMARK;
        button.addEventListener('click', () => (overlay && !overlay.hidden ? close() : open()));

        // The homepage, Rules, Privacy, 404: .nav-inner. The Bookie, Messages, the tracker:
        // .header-container. Admin: .admin-nav. Left of the bell, which pages put before their menu
        // button (or Admin's Log out); a bell that comes later lands between this and the menu.
        const host = document.querySelector('#site-nav .nav-inner, .site-header .header-container, #auth-status.admin-nav');
        if (!host) {
            button.classList.add('is-floating');
            document.body.appendChild(button);
            return;
        }
        const kids = [...host.children];
        const before = kids.find(el => el.classList.contains('bbb-bell'))
            || kids.find(el => el.matches('.nav-toggle, .menu-toggle, #logout-btn'))
            || null;
        host.insertBefore(button, before);
        if (host.classList.contains('header-container')) host.classList.add('has-help');
        fit();
        window.addEventListener('resize', fit);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(() => {});
    }

    // The homepage's full desktop row: if the ? (or the bell beside it) would hang off the right
    // edge, fold the row's links into the menu button. bell.js runs the same check.
    function fit() {
        const parent = button && button.parentElement;
        if (!parent || !parent.classList.contains('nav-inner')) return;
        parent.classList.remove('bell-tight');
        const over = [...parent.children].some(el => {
            if (!el.matches('.bbb-help, .bbb-bell') || el.hidden) return false;
            const r = el.getBoundingClientRect();
            return r.right > window.innerWidth - 2 || r.left < 0;
        });
        if (over) parent.classList.add('bell-tight');
    }

    function build() {
        overlay = node('div', 'bbb-help-overlay');
        overlay.hidden = true;
        panel = node('div', 'bbb-help-panel');
        panel.id = 'bbb-help-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'bbb-help-title');

        const head = node('div', 'bbb-help-head');
        const titles = node('div', 'bbb-help-titles');
        const title = node('h2', 'bbb-help-title', 'Help');
        title.id = 'bbb-help-title';
        title.tabIndex = -1;
        const sub = node('p', 'bbb-help-sub');
        titles.append(title, sub);
        const x = node('button', 'bbb-help-close', '×');
        x.type = 'button';
        x.setAttribute('aria-label', 'Close help');
        x.addEventListener('click', () => close());
        head.append(titles, x);

        const search = node('div', 'bbb-help-search');
        search.setAttribute('role', 'search');
        search.innerHTML = LENS;
        const input = node('input', 'bbb-help-input');
        input.type = 'search';
        input.placeholder = 'Search help: deposit, odds, offline…';
        input.setAttribute('aria-label', 'Search help');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('enterkeyhint', 'search');
        input.addEventListener('input', () => render());
        input.addEventListener('keydown', e => {
            if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; render(); }
        });
        search.appendChild(input);

        const status = node('p', 'bbb-help-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const body = node('div', 'bbb-help-body');

        const foot = node('div', 'bbb-help-foot');
        foot.innerHTML = '<p><a href="/help.html">Open all of Help as a page</a></p>' +
            `<p>Still stuck? Ask in the group text, or email <a href="mailto:${esc(facts().inbox)}">${esc(facts().inbox)}</a>.</p>`;

        panel.append(head, search, status, body, foot);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        els = { title, sub, input, status, body, foot };

        // A press on the dimmed page beside the panel closes it
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        panel.addEventListener('keydown', trapTab);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) close(); });
        // Links: another answer opens in place; a page on the site closes Help on the way
        panel.addEventListener('click', e => {
            const link = e.target.closest('a');
            if (!link || !panel.contains(link)) return;
            if (link.dataset.topic) {
                e.preventDefault();
                show(link.dataset.topic);
                return;
            }
            if (link.target !== '_blank' && !/^mailto:/i.test(link.getAttribute('href') || '')) close(false);
        });
    }

    function focusables() {
        return [...panel.querySelectorAll('button, a[href], input, summary')]
            .filter(el => !el.disabled && el.getClientRects().length);
    }
    function trapTab(e) {
        if (e.key !== 'Tab') return;
        const list = focusables();
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === els.title)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    // What the panel shows: search results, or this page's answers and then every section
    function render() {
        const q = els.input.value.trim();
        const body = els.body;
        body.textContent = '';
        els.status.textContent = '';
        if (q) {
            const hits = searchHits(q);
            const found = hits.map(h => h.t);
            if (!found.length) {
                const p = node('p', 'bbb-help-empty');
                p.textContent = `Nothing matches “${q}”. Try another word, like “bet”, “RSVP” or “phone”.`;
                const clear = node('button', 'bbb-help-clear', 'Show all topics');
                clear.type = 'button';
                clear.addEventListener('click', () => { els.input.value = ''; render(); els.input.focus(); });
                body.append(p, clear);
                els.status.textContent = 'No answers found.';
                return;
            }
            // The answers about it, then (set apart) the ones that only mention it
            const strong = hits.filter(h => h.strong).map(h => h.t);
            const weak = hits.filter(h => !h.strong).map(h => h.t);
            const main = strong.length ? strong : weak;
            els.status.textContent = main.length === 1 ? '1 answer' : `${main.length} answers`;
            const list = listOf(main, { where: true });
            if (main.length === 1) list.querySelector('details').open = true;
            body.appendChild(list);
            if (strong.length && weak.length) {
                body.appendChild(node('h3', 'bbb-help-group', 'Also mentioned in'));
                body.appendChild(listOf(weak, { where: true }));
            }
            return;
        }
        const page = pageKey();
        const mine = pageTopics(page);
        if (mine.length) {
            body.appendChild(node('h3', 'bbb-help-group', `On ${PAGE_NAMES[page] || 'this page'}`));
            body.appendChild(listOf(mine));
        }
        body.appendChild(node('h3', 'bbb-help-group', mine.length ? 'Everything else' : 'All topics'));
        const ul = node('ul', 'bbb-help-list');
        SECTIONS.forEach(sec => {
            const topics = TOPICS.filter(t => t.s === sec.id && shown(t));
            if (!topics.length) return;
            const li = node('li');
            const d = node('details', 'bbb-help-sec');
            d.dataset.section = sec.id;
            const s = node('summary');
            s.appendChild(node('span', 'bbb-help-q', sec.title));
            s.appendChild(node('span', 'bbb-help-count', String(topics.length)));
            s.insertAdjacentHTML('beforeend', CHEV);
            d.append(s, listOf(topics));
            li.appendChild(d);
            ul.appendChild(li);
        });
        body.appendChild(ul);
    }

    // Open one answer: the first copy of it in the panel (this page's list, else its section)
    function show(id) {
        if (!TOPICS.some(t => t.id === id)) return false;
        if (els.input.value) { els.input.value = ''; render(); }
        const el = els.body.querySelector(`details[data-topic="${CSS.escape(id)}"]`);
        if (!el) return false;
        const sec = el.closest('.bbb-help-sec');
        if (sec) sec.open = true;
        el.open = true;
        el.scrollIntoView({ block: 'start' });
        const summary = el.querySelector('summary');
        if (summary) summary.focus({ preventScroll: true });
        return true;
    }

    function open(topicId) {
        if (!overlay) build();
        if (!overlay.hidden) { if (topicId) show(topicId); return; }
        lastFocus = document.activeElement;
        const page = pageKey();
        els.sub.textContent = PAGE_NAMES[page] && page !== 'lost'
            ? `Answers for ${PAGE_NAMES[page]} and the rest of the site`
            : 'Answers for every part of the site';
        els.input.value = '';
        render();
        overlay.hidden = false;
        document.documentElement.classList.add('bbb-help-open');
        if (button) button.setAttribute('aria-expanded', 'true');
        els.body.scrollTop = 0;
        if (topicId && show(topicId)) return;
        // A mouse and keyboard: straight into the search box. A phone: no keyboard popping up
        const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        (fine ? els.input : els.title).focus({ preventScroll: true });
    }

    function close(returnFocus = true) {
        if (!overlay || overlay.hidden) return;
        overlay.hidden = true;
        document.documentElement.classList.remove('bbb-help-open');
        if (button) button.setAttribute('aria-expanded', 'false');
        if (returnFocus) {
            // Back where it was: usually the ? (Safari doesn't focus a tapped button, so the page itself)
            const to = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : button;
            if (to && to.focus) to.focus({ preventScroll: true });
        }
    }

    // ---- the help page (help.html) ---------------------------------------------------------------
    // Every section with its answers, a search box that narrows them, and help.html#id opening one
    function renderPage(root) {
        if (!root) return;
        const nav = root.querySelector('[data-help-sections]');
        const list = root.querySelector('[data-help-list]');
        const input = root.querySelector('[data-help-search]');
        const status = root.querySelector('[data-help-status]');
        if (!list) return;

        SECTIONS.forEach(sec => {
            const topics = TOPICS.filter(t => t.s === sec.id && shown(t));
            if (!topics.length) return;
            const block = node('section', 'help-sec');
            block.id = 'sec-' + sec.id;
            block.dataset.section = sec.id;
            const h = node('h2', 'help-sec-title', sec.title);
            block.appendChild(h);
            if (sec.blurb) block.appendChild(node('p', 'help-sec-blurb', sec.blurb));
            const ul = listOf(topics, { id: true, page: true });
            ul.querySelectorAll('.bbb-help-a').forEach(a => {
                const id = a.parentElement.dataset.topic;
                const copy = node('button', 'help-copy', 'Copy link to this answer');
                copy.type = 'button';
                copy.addEventListener('click', () => copyLink(id, copy));
                a.appendChild(copy);
            });
            block.appendChild(ul);
            list.appendChild(block);
            if (nav) {
                const a = node('a', 'help-chip', sec.title);
                a.href = '#sec-' + sec.id;
                nav.appendChild(a);
            }
        });

        function copyLink(id, btn) {
            const url = `${location.origin}${location.pathname}#${id}`;
            const done = ok => {
                btn.textContent = ok ? 'Link copied' : url;
                if (ok) setTimeout(() => { btn.textContent = 'Copy link to this answer'; }, 2000);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
            else done(false);
        }

        if (input) {
            input.addEventListener('input', () => {
                const q = input.value.trim();
                // The answers about it; only if there are none, the ones that mention it
                const hits = q ? searchHits(q) : [];
                const strong = hits.filter(h => h.strong);
                const keep = q ? new Set((strong.length ? strong : hits).map(h => h.t.id)) : null;
                let shown = 0;
                list.querySelectorAll('.help-sec').forEach(block => {
                    let any = false;
                    block.querySelectorAll('details.bbb-help-topic').forEach(d => {
                        const on = !keep || keep.has(d.dataset.topic);
                        d.parentElement.hidden = !on;
                        if (on) { any = true; shown++; }
                    });
                    block.hidden = !any;
                });
                // Down to one answer: open it
                if (keep && keep.size === 1) {
                    const only = document.getElementById([...keep][0]);
                    if (only) only.open = true;
                }
                if (status) status.textContent = !q ? '' : shown ? (shown === 1 ? '1 answer' : `${shown} answers`) : `Nothing matches “${q}”. Try another word, like “bet”, “RSVP” or “phone”.`;
            });
        }

        // help.html#topic-id: open that answer and bring it into view
        function landOnHash(scroll) {
            const id = decodeHash(location.hash.slice(1));
            if (!id) return;
            const el = document.getElementById(id);
            if (!el) return;
            if (el.matches('details')) el.open = true;
            if (scroll) {
                const root = document.documentElement, was = root.style.scrollBehavior;
                root.style.scrollBehavior = 'auto';
                el.scrollIntoView({ block: 'start' });
                root.style.scrollBehavior = was;
            }
        }
        landOnHash(true);
        window.addEventListener('hashchange', () => landOnHash(true));
        window.addEventListener('load', () => landOnHash(true), { once: true });
    }

    // ---- start ----------------------------------------------------------------------------------
    function start() {
        if (pageKey() !== 'help') placeButton();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.BBBHelp = { open, close, renderPage, search, topics: TOPICS, sections: SECTIONS };
})();
