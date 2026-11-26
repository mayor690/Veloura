# Veloura

Anonymous, 18+, daily-unlock content platform. Next.js 15 (App Router) + TypeScript + Tailwind v4 + Supabase.

**Status:** Steps 1 to 6 complete (feature complete for launch preparation): scaffold and theme, database, anonymous auth, age gate, homepage gallery,
category feeds, wallet-based unlock, crypto top-ups via NOWPayments (USD-priced, admin-set FX rate), posting with
image/video uploads to **Cloudflare R2** (multipart + resume), and the **admin dashboard and safety tools**: report
buttons, urgent queue + regular queues, takedown/quarantine, users/roles/bans, stats, payments, creator payouts,
ads + sponsored posts, a settings form (including the USD exchange rate), reactions and pre-moderated comments, the
nightly creator earnings job (view 1 / reaction 2 / approved comment 3, 40% share), and rate limiting on login,
recovery and registration.
Quality checks: type-checks clean; 14 unit tests (`npm test`); and `npm run test:sql` runs every migration on a real
throwaway Postgres and checks 89 money, safety and permission rules. **Not yet run against a live Supabase project,
NOWPayments account or R2 bucket, and not tested on real phones.**
Before launch: work through **docs/LAUNCH_CHECKLIST.md** and the in-app **Admin, Launch checks** page.

**Storage:** all images and videos live in a private Cloudflare R2 bucket. Supabase is used for the database and
auth only. See docs/ARCHITECTURE.md.

## Setup

1. Create a Supabase project. Run the migrations in order (`supabase/migrations/0001` to `0009`) in the SQL
   editor, or `npx supabase link` + `npx supabase db push`.
2. `cp .env.example .env.local` and fill it in (Supabase keys, `RECOVERY_PEPPER`, site URL).
3. Crypto: follow **docs/NOWPAYMENTS_SETUP.md** (account, API key, IPN secret, exchange rate, testing).
4. Media: follow **docs/R2_SETUP.md** (bucket, API token, CORS, env vars, testing).
5. Admin and safety: follow **docs/ADMIN_AND_SAFETY.md** (roles, queues, payouts, settings, test checklist).
   Earnings and comments: **docs/EARNINGS.md**. Launch: **docs/LAUNCH_CHECKLIST.md**.
   Set `PAYOUT_ENCRYPTION_KEY` (`openssl rand -hex 32`) and back it up.
6. `npm install && npm run dev`

Users are created server-side with a synthetic email (`username@users.veloura.app`). No real email is collected.

## Admin, test balance, demo posts (SQL editor; replace `yourname`)

```sql
update profiles set role = 'admin' where username = 'yourname';

insert into wallet_ledger (user_id, delta_kobo, reason)
select id, 1000000, 'adjustment' from profiles where username = 'yourname';   -- ₦10,000 test balance

insert into posts (author_id, category_id, title, body, preview_text, status, published_at)
select p.id, c.id, 'Demo post ' || g, 'Full body of demo post ' || g || '.', 'A teaser for demo post ' || g, 'approved', now()
from profiles p, categories c, generate_series(1,3) g
where p.username = 'yourname' and c.slug = 'money-tips';

-- exchange rate (NGN per 1 USD): placeholder 1500 is seeded, set the real value
update site_settings set value = '1500', updated_at = now() where key = 'usd_ngn_rate';
```

## Product model

Veloura is **premium-only**: there is no free content or free tier. An account is free to create (it is how you pay), but every post needs an active unlock (₦112 for a category, ₦280 for all, 24 hours). Visitors can see category names and post titles only.

**Posting is open:** any account can submit a post for moderation without an active unlock (to encourage content creation). Only **viewing, reacting and commenting** need an unlock. Posting is protected by moderation, a cap of 10 posts waiting for review, upload limits and the consent checkbox.

## Money model

- Prices are stored in kobo. Daily ₦112, Full Pass ₦280, in `site_settings`.
- Crypto top-ups are priced in USD. Wallet credit = USD paid × `usd_ngn_rate`, locked per payment when the
  invoice is created. NGN is only shown for display.
- Unlocks last a rolling 24 hours. Unlock prices are computed in SQL, never trusted from the client.
- Only the verified, idempotent webhook (`/api/webhooks/crypto`) credits crypto payments.

## Security notes

- `posts.body` and `author_id` are not readable from the browser (column grants); `payments.raw_webhook` too.
  Browser queries on those tables must list columns explicitly; `select("*")` is blocked on purpose.
- The service role key and NOWPayments secrets are server-only.

## Moderation and safety

Staff (`role` = `admin` or `moderator`) work at `/admin/moderation`: **Urgent** (possible-minor and non-consensual reports;
the post is hidden automatically), **Reports**, **New posts**, **Live posts**. A red banner shows on every admin page
while anything urgent is waiting. Every action is written to `audit_logs`. See docs/ADMIN_AND_SAFETY.md.

## Before launch

- Confirm your payment processor allows this content category in writing. Do not assume.
- Rate limiting on login/recover, real legal text, legal advice on reporting/retention duties for urgent takedowns. Video length and resolution are checked in the
  browser only (the server cannot decode video), so moderators must watch every video; see docs/R2_SETUP.md.
- Confirm Cloudflare R2 allows this content category in writing.
- Replace the placeholder Terms, Privacy and Content Policy pages.
