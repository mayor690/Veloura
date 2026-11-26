# Creator earnings, reactions and comments

## How creators earn

Every night at **00:30 Lagos time** (`/api/cron/daily-earnings`, scheduled 23:30 UTC in `vercel.json`) the app pays out
the **previous Lagos day**:

1. **Revenue** = money actually spent on unlocks that day (wallet spend plus direct crypto passes). Top-ups are not revenue until spent.
2. **Pool** = 40% of revenue (the `creator_share_pct` setting) plus any amount carried over from earlier days.
3. **Points** for each live post that day:
   - 1 point per **view** (every view is a paid view; one per user per post per day),
   - 2 points per **reaction** (one reaction per user per post),
   - 3 points per **approved comment** (counted on the day it was approved).
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
- Pending or rejected comments.

Only people who have **unlocked the category** can react or comment on a premium post (checked in the database).

### Why self-dealing doesn't pay

To inflate your own points from extra accounts, each account must pay for an unlock first. At most 40% of what they pay
goes into the pool, and it is shared with every other creator, so paying to boost yourself loses money on average. The
daily limits (3 comments per post, 20 per day, 5 waiting for review) cap the rest. Watch for clusters of new accounts that
only ever interact with one creator, and ban them.

## Comments are always reviewed first

Comments start as **pending** and only appear after a moderator approves them (**Admin, Moderation, Comments**). Approved
comments can be removed later. This is deliberate for an adult platform. If the queue becomes too big, the options are
more moderators, trusted-commenter auto-approval, or a keyword pre-filter; each needs care, so they are not built in.
Comments cannot be reported by readers yet; staff remove them from the Comments tab.

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
