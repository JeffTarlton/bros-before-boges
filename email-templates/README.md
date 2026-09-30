# Supabase auth emails

Branded templates for the emails Supabase sends (sign-up, password reset, and so on).
Paste each one into **Supabase → Authentication → Emails → Templates**. Use the subject
line from the table and paste the whole file into the message body (HTML).

| Supabase template      | File                     | Subject                                      |
|------------------------|--------------------------|----------------------------------------------|
| Confirm sign up        | `confirm-signup.html`    | Confirm your email · Bros before Boges       |
| Invite user            | `invite-user.html`       | You’re in: Bros before Boges 2027            |
| Magic link             | `magic-link.html`        | Your login link · Bros before Boges          |
| Change email address   | `change-email.html`      | Confirm your new email · Bros before Boges   |
| Reset password         | `reset-password.html`    | Reset your password · Bros before Boges      |
| Reauthentication       | `reauthentication.html`  | Your confirmation code · Bros before Boges   |

Notes
- `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}` and `{{ .NewEmail }}` are filled in by Supabase.
- `{{ .Data.roster_name }}` is the roster name The Bookie saves at sign-up, so those emails greet
  people by name. The `{{ if }}` around it leaves the name out for logins made elsewhere.
- Images load from the live site (`apple-touch-icon.png`, `assets/courses/og-card.jpg`); keep those
  paths when redesigning, or update the templates.
- Every link lands on the site. The homepage forwards sign-in links to `bookie.html`, which handles
  confirmations, invites (choose a password), resets and expired links.

Sending setup (Google Workspace account brosbeforeboges@lokdit.net):
Authentication → Emails → SMTP Settings: host `smtp.gmail.com`, port `465`, username
`brosbeforeboges@lokdit.net`, password = a Google **app password** for that account,
sender `brosbeforeboges@lokdit.net`, sender name `Bros before Boges`.

**Link setup (required for every email link):** Authentication → URL Configuration:
Site URL `https://bros-before-boges.vercel.app`, and Redirect URLs include
`https://bros-before-boges.vercel.app/**`. Without it, Supabase ignores the site's return
address and sends reset and confirmation links to the Site URL (by default `localhost`,
which is a dead page on a phone).

## RSVPs and accounts (rsvp_accounts.sql)

RSVPs need a player account (the same login as The Bookie). To switch this on:
1. Deploy the site update first. Until step 2 runs, the new RSVP form says "RSVPs are being set
   up" instead of failing silently.
2. Right after the deploy, run `rsvp_accounts.sql` in the Supabase SQL Editor. Its result lists
   any old RSVP it couldn't match to a roster name and every admin. Each admin should say
   "has a login"; if one says "NO LOGIN YET", have them log in once (or turn on Confirm email).
3. Keep **Allow new users to sign up** on: new players create their own accounts.

**The invite link to send the guys:** https://bros-before-boges.vercel.app/signup
It opens the sign-up form (name from the roster, or “I’m new”), sends the “Confirm your email”
message, and the link in that email logs them in and drops them straight into the RSVP. Anyone who
already has an account taps “Already have an account? Log in” on the same page. New players show
up in Admin → RSVPs to approve, and every RSVP (and every new player) emails
brosbeforeboges@lokdit.net with Jeff on copy. (The first alert needs FormSubmit’s one-time
activation click.)

## The Bookie and the Round Tracker (2027 setup)

Run these once in the Supabase SQL Editor, after `rsvp_accounts.sql`. Both are safe to run again.
- `bookie_2027.sql`: turns on prop bets and makes the database hold every bet to the page’s rules
  (only confirmed players bet, only the player challenged accepts, winners come from the players in
  the bet, and so on). Admins can still fix anything.
- `tracker_2027.sql`: the live leaderboard opens to everyone (signed in or not), only confirmed
  players can enter scores, hole scores must be 1 to 20, and scorecard totals are worked out from
  the holes. The tracker works without it, but run it before the trip.

The Round Tracker’s formats per round live in `trip-config.js` (`roundPlay`). They’re the 2026
formats until the 2027 ones are set. Admin → Score Entry has **Fill from Round Tracker** to copy
the groups’ cards in for the homepage scoreboard.

What it sets up: RSVPs, profile updates and approvals go through database functions that act as
the signed-in player, and the players table only accepts roster changes from an admin. Everyone
else can only link an unclaimed roster name to their own login (The Bookie's name picker). The
Supabase table editor and SQL editor are not restricted.

## Sign in with Google (parked)

Built and tested, but switched off for now: `auth.google` is `false` in `trip-config.js`, so no
Google buttons show anywhere. To turn it on later, do steps 1–5 below (and the link setup
above), then set `auth.google` to `true` and deploy.

Google logins use the same accounts as email logins. Someone who signs in with Google using the
same address as an existing account lands on that account. Even with `auth.google` on, the buttons
only appear while the provider is enabled in Supabase, so a half-finished setup never shows them.

1. **Google Cloud Console** (console.cloud.google.com), signed in as brosbeforeboges@lokdit.net:
   create a project named "Bros before Boges".
2. **Google Auth Platform → Branding**: app name `Bros before Boges`, support email
   `brosbeforeboges@lokdit.net`, logo optional.
3. **Audience**: choose **External** (Internal would allow only lokdit.net accounts), then
   **Publish app**. With only the basic email/profile scopes, Google doesn't require a review;
   while the app is in "Testing", only listed test users can sign in.
4. **Clients → Create client → Web application**:
   - Authorized JavaScript origins: `https://bros-before-boges.vercel.app`
   - Authorized redirect URIs: `https://gxpwgrdyizruzfczzqwn.supabase.co/auth/v1/callback`
5. Copy the **Client ID** and **Client secret** into **Supabase → Authentication → Sign In / Providers →
   Google**, then turn on **Enable Sign in with Google**. Leave "Skip nonce checks" and "Allow users
   without an email" off.

Google's consent screen will say "continue to gxpwgrdyizruzfczzqwn.supabase.co". Showing the site's
own name there requires a Supabase custom domain, which is a paid add-on.
