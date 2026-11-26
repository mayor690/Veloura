# Creator earnings, reactions and comments

## How creators earn

Every night at **00:30 Lagos time** (`/api/cron/daily-earnings`, scheduled 23:30 UTC in `vercel.json`) the app pays out
the **previous Lagos day**:

1. **Revenue** = money actually spent on unlocks that day (wallet spend plus direct crypto passes). Top-ups are not revenue until spent.
2. **Pool** = 40% of revenue (the `creator_share_pct` setting) plus any amount carried over from earlier days.
3. **Points** for each live post that day:
   - 1 point per **view** (every view is a paid view; one per user per post per day),
   - 2 points per **reaction** (one reaction per user per post),
   - 3 points per **commenter**: only an account's first approved comment on a post counts, on the day it was approved.
     Further comments by the same account on that post still appear, but earn nothing on any day.
4. Each post receives `pool × its points ÷ total points`. Amounts are rounded with the largest-remainder method so they add up to
   the pool **exactly, to the kobo**.
5. Each author is credited once for the day in their creator balance (`creator_ledger`), visible on **Dashboard, Earnings**
   with a per-post breakdown. They can then request a payout.

If nobody earned any points that day, the pool is **carried over** to the next day rather than lost.

### Worked example

Day revenue ₦504 (₦112 + ₦280 + ₦112), pool ₦201.60 plus ₦49.38 carried = ₦250.98. Post A has 2 views, 1 reaction and
1 comment (7 points), post B has 1 view (1 point), post C has 1 view and 1 reaction (3 points). Total 11 points:
A ≈ ₦159.71, B ≈ ₦22.82, C ≈ ₦68.45 (the sum is exactly ₦250.98).

(The checks in `scripts/sql_smoke_test.py` run exactly this scenario.)

## What does not count

- An author's **own** views, reactions and comments on their posts.
- Anything by a **banned** user, and anything on posts by a banned author.
- Posts that are not live: pending, rejected, removed, or hidden while a report is reviewed.
- Pending or rejected comments, and any second or later comment by the same account on the same post.

Only people who have **unlocked the category** can react or comment on a premium post (checked in the database).

### Why self-dealing doesn't pay

To inflate your own points from extra accounts, each account must pay for an unlock first. At most 40% of what they pay
goes into the pool, and it is shared with every other creator, so paying to boost yourself loses money on average. The
daily limits (3 comments per post, 20 per day, 5 waiting for review) cap the rest. Watch for clusters of new accounts that
only ever interact with one creator, and ban them.

## Comments are always reviewed first

Comments start as **pending** and only appear after a moderator approves them (**Admin, Moderation, Comments**). Approved
comments can be removed later. This is deliberate for an adult platform.

Safety layers (run `supabase/migrations/0008_comment_safety.sql`):

- **Pre-filter (before anything is saved).** Comments containing links, emails, phone numbers, social handles or contact
  phrases ("dm me", "whatsapp") are refused with a message and never stored. Comments that mention ages under 18 or
  minor-related words are still saved as pending but **flagged**, and show first in the review queue. The word lists live in
  `src/lib/comment-filter.ts` and are covered by unit tests. The filter never approves anything.
- **Reader reports.** Readers who can see a comment have a **Report** link on it (one report per reader per comment, 20 a day).
  Serious reasons (possible minor, no consent, illegal) pull the comment off the page at once and back into the review
  queue flagged. Other reasons leave it live and list it under **Reported by readers**, where staff can remove it or dismiss
  the reports.
- **Visibility.** The admin nav shows a count next to **Moderation**, and the overview has a **Comments to review** card.

- **Trusted accounts (optional, off by default).** In **Admin, Settings, Comments**, an admin can let established accounts
  comment without review (`supabase/migrations/0010_trusted_commenters.sql`). A comment goes live at once only when the
  switch is on, the pre-filter did not flag it, the account has at least the set number of approved comments (default 5),
  none of its comments was rejected or removed in the last 90 days, and none has an open reader report. Everything else is
  reviewed as before. Auto-approved comments are marked in the **Recently approved** list. Turn the switch off and every
  comment is reviewed again immediately. The daily comment limits still apply.

## Tips

Readers can tip an author from their wallet (`supabase/migrations/0012_tips.sql`). Tips are anonymous: the author sees the
amount and the post, never who sent it.

- The reader is debited the full amount. The author is credited the amount minus the platform fee, straight away, into the
  same creator balance that nightly earnings use, and is paid out through the same payout request.
- Tips are **not** unlock revenue, so they never enter the nightly pool.
- Only a reader who currently has access to the post's category can tip it. Nobody can tip their own post, and banned or
  hidden or removed posts cannot be tipped.
- **Admin, Settings, Tips** controls: on/off, platform fee (default 10%), minimum (₦100), maximum (₦50,000) and a daily cap
  per reader over any rolling 24 hours (₦100,000). Changes apply to new tips only.
- Tips are final. To undo one, use **Admin, Users, Adjust a balance** with a note.
- Authors see their tips under **Dashboard, Earnings**; admins see 30-day tip totals on **Admin, Earnings**.

## Operating it

- **Admin, Earnings** shows every run (revenue, pool, paid out, carried, points) with a per-post breakdown, and a
  **Run now** button that pays any finished days that were missed. Running it twice is harmless.
- The job is idempotent three ways: one row per day in `earnings_runs`, one ledger row per post per day, and a unique
  index on creator earnings credits.
- It catches up at most 7 missed days. The first run ever pays only yesterday.
- Weights and share are settings; a run records the weights it used.
- **Not included:** advertising income. Ads are tracked for display only, so the creator share is of unlock revenue.
  Add ad revenue to the pool later if you want creators to share it.
- Creator balances are real liabilities. The overview shows "Owed to creators" next to what wallets still hold.
