# Launch checklist

The app checks what it can on **Admin, Launch checks** (environment variables, R2 connection, exchange rate, nightly job,
at least one admin). Everything else is below. Do not launch with unticked items in **Legal** or **Money**.

## Legal and policy
- [ ] Terms, Privacy and Content Policy written or reviewed by a lawyer who knows the places you operate in (the shipped pages are placeholders).
- [ ] Written confirmation from your crypto payment provider and from Cloudflare that this content category is allowed.
- [ ] Legal advice on your duties to report and retain material involving suspected minors or non-consensual content; your quarantine procedure matches it.
- [ ] A published contact for takedown requests and law-enforcement queries, with someone who answers it.
- [ ] A moderator rota: the Urgent tab is checked every day, with a target response time you can meet.
- [ ] You have decided what you tell users about data: what you store (username, hashed recovery code, content, payments), and that you cannot recover a lost recovery code.

## Money
- [ ] One real $1 top-up end to end: invoice, webhook, wallet credit, unlock, funds arrive in your payout wallet.
- [ ] Replay the same webhook; the wallet must not be credited twice.
- [ ] Set the real USD to NGN rate in Settings and decide who updates it and how often (stale rates cost you money).
- [ ] Process one real payout end to end. Confirm the network before every USDT transfer.
- [ ] Decide your refund policy (crypto has no chargebacks). Use Users, Adjust a balance for refunds; every adjustment needs a note.
- [ ] Reconcile weekly: wallet liability plus creator liability should be covered by the funds you hold.

## Security
- [ ] All secrets exist only in your host's environment settings. None are committed. `.env.local` is in `.gitignore`.
- [ ] `PAYOUT_ENCRYPTION_KEY` is backed up separately from the app (a password manager plus a sealed offline copy). Losing it makes saved payout accounts unreadable.
- [ ] Two-factor authentication on Supabase, Vercel (or your host), Cloudflare, NOWPayments, your email and your domain registrar.
- [ ] Supabase backups are on (a paid plan) or you run scheduled exports, and you have **tested a restore**.
- [ ] Row Level Security is on for every table (the migrations do this; confirm in the Supabase dashboard).
- [ ] Run `python3 scripts/sql_smoke_test.py` against the final migrations. It checks the money, safety and permission rules on a real Postgres.
- [ ] The Supabase **anon key** is not exposed to browsers. This app never uses it client-side; keep it that way (the unused browser client was removed). Also review Supabase Auth's own rate limits, because someone with the project URL and anon key could call Supabase Auth directly and bypass this app's login limiter.
- [ ] The first admin is created by SQL, and staff accounts use strong unique passwords.
- [ ] Optional hardening after launch: a Content-Security-Policy header (needs testing with Next's inline scripts), and CAPTCHA on registration if you see bot sign-ups.

## Operations
- [ ] Error monitoring (for example Sentry) and an uptime monitor on `/api/health`.
- [ ] Vercel cron jobs show as running (cleanup 03:00 UTC, earnings 23:30 UTC); `CRON_SECRET` is set.
- [ ] R2 CORS lists your production domain; the abort-incomplete-multipart lifecycle rule is set.
- [ ] Alert (email or message) when payouts are waiting or the Urgent queue has items older than your target.
- [ ] A status/maintenance plan: Settings has a maintenance switch; staff can still sign in.

## Product
- [ ] Registration, login, recovery-code flow and the 18+ gate tested on a real iPhone (Safari) and Android (Chrome).
- [ ] Video recording and upload tested on both phones, including a dropped connection mid-upload and a 45-second clip.
- [ ] A full path as a new user: register, top up, unlock, read, react, comment, report. And as a creator: post, get approved, earn, request a payout.
- [ ] Seed some real approved content in every category so the site isn't empty on day one.
- [ ] Replace placeholder copy and add your logo, favicon and share image.

## Limits that are in place (so you know what to expect)

| Where | Limit |
|---|---|
| Login | 5 wrong passwords per username on one device per 15 min; 20 per username across all devices per hour; 30 per device per 15 min |
| Recovery | 5 failures per username and device per hour; 15 per username per day; 20 per device per hour |
| Registration | 15 attempts per device per hour; 5 accounts per device per day |
| Reports | 20 per user per day, one per post |
| Comments | 3 per post and 20 per day per user; 5 waiting for review |
| Uploads | 40 per hour; 20 unattached uploads; 10 posts waiting for review |
| Crypto invoices | 5 unpaid per hour |

Devices are identified by a keyed hash of the IP address (the raw IP is not stored). A shared IP (an office, a mobile carrier)
can hit device limits together; the numbers are deliberately loose enough for that. Attempt records are deleted after 2 days.
If the platform gives no IP, the per-device rules are skipped and the per-username rules still apply.
