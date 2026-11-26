# Admin dashboard and safety tools

Run `supabase/migrations/0005_admin_safety.sql` first. Make your first admin in the SQL editor:
`update profiles set role = 'admin' where username = 'yourname';` (after that, manage roles on /admin/users).

## Who can do what

| Area | Moderator | Admin |
|---|---|---|
| Overview (queues, users, views, charts) | yes | yes, plus money stats |
| Moderation: urgent queue, reports, new posts, comments, live posts | yes | yes |
| Take down a post, dismiss reports | yes | yes |
| Ban the author while taking a post down | no | yes |
| Users: ban, unban, roles, balance adjustments | no | yes |
| Payments, earnings runs, payouts, ads, sponsored posts, settings, launch checks | no | yes |
| Quarantine (permanent delete), audit log | no | yes |

Every admin action re-checks the role on the server (the layout alone is not trusted) and writes to `audit_logs`.

## Restricting an account (mute) and banning

- **Restrict commenting and reactions** (Admin, Users; admins only): pick 1 day, 7 days, 30 days or until lifted, with an
  optional reason. The account can still read, post and report, but cannot comment or react until the restriction ends.
  Taking back a reaction is still allowed. The user sees a message with the end date. Lift it any time with **Lift comment
  restriction**. Staff accounts and banned accounts cannot be restricted.
- **Reject and restrict 7 days** (Moderation, Comments; moderators and admins) rejects a pending comment and restricts its author in one click.
- **Ban** is separate and stays permanent until an admin lifts it. Every restriction and ban is written to the audit log.
- Needs `supabase/migrations/0011_mute_restriction.sql`.

## Reports and the urgent queue

- Every post card and post page has a **Report** button (logged-in users; anonymous to the poster). One report per
  user per post, 20 per user per day.
- Reasons **"possible minor"** and **"non-consensual"** are **urgent**. An urgent report **hides the post immediately**
  (`posts.held_at`), before any human looks, and it goes to the **Urgent** tab.
- All other reasons go to the **Reports** tab and the post stays up.
- Urgent items are never buried: a red banner with the count and the oldest age shows at the top of **every** admin
  page, the Urgent tab is the default whenever anything is waiting, it is sorted oldest first, and the overview shows
  it first.
- Reports on the same post are grouped, with reasons and reporters' notes. Reporter identity is never shown to staff.
- **Dismiss** closes the reports and restores the post. **Take down** removes it.

**Risk to know about:** automatic hiding means a bad actor could hide posts by filing false urgent reports. The limits
above reduce it; watch for repeat reporters on the audit log, and consider requiring a minimum account age before a
report can auto-hide a post.

## Takedown and quarantine

- Routine takedown: post set to `removed`, media **deleted** from R2.
- Takedown with an urgent report open (or "keep as evidence" ticked): media is **quarantined**. It stays in the private
  bucket, is never displayed (not even to staff), and is listed on /admin/quarantine.
- **Get legal advice** on your reporting and retention duties for suspected-minor and non-consensual material in the
  places you operate before deleting quarantined media. The "Delete permanently" action is irreversible and audited.
- Rejecting a post during pre-publication review deletes its media immediately.

## Money screens

- **Overview:** top-ups (cash in), unlock spend, **wallet liability** (prepaid balances you still owe as content access),
  **creator liability**, pending payouts, active unlocks. "Traffic" means sign-ups and recorded premium views; add a
  privacy-friendly analytics tool for visitor-level traffic.
- **Payments:** filter by status/type, search by reference, see the provider payload. To fix a partial or wrong payment,
  use **Users, Adjust a balance** (note required, audited). Direct "mark as paid" is intentionally not offered.
- **Payouts:** a creator's request holds the money (deducted from their balance). You open the payout to see the
  decrypted destination (each view is logged), send the money outside the app, then **mark paid** with the transfer
  reference or tx hash, or **reject** with a reason, which returns the funds. USDT destinations show the dollar
  equivalent at the current rate. Always confirm the network before sending.
- Payout account details are encrypted with `PAYOUT_ENCRYPTION_KEY` (AES-256-GCM). **Back the key up**: without it saved
  accounts can't be read. Bank payouts reveal a creator's real name to admins; USDT is the anonymous option.
- Creator balances are credited automatically every night (see docs/EARNINGS.md); use Users, Adjust only for corrections and bonuses.

## Settings (no SQL needed)

/admin/settings edits: the **USD to NGN rate**, category and Full Pass prices, unlock length, top-up minimums/maximum,
creator share, minimum payout, and switches for ads, crypto, sign-ups and maintenance mode.

- Saving **re-confirms the exchange rate** (clears the "rate is stale" warning on the overview).
- A rate change of more than 15% needs a confirmation tick, to catch typos.
- Maintenance mode hides public pages for everyone except signed-in staff.
- Each save is audited with the old and new values.

## Ads and sponsored posts

- A global switch (Ads page) hides all ads and sponsored posts instantly. Each placement (homepage, feed inline, post
  bottom) can be switched off separately.
- Banner/native ads: advertiser, link (https only), headline, text, image, schedule (Lagos time), pause/resume/delete.
- Sponsored posts: shown inside category feeds, labelled "Sponsored", every N-th post, for one category or all.
- Creative images are stored in the private R2 bucket and served through `/api/ads/img`; clicks go through
  `/api/ads/click` (counts, then redirects to the advertiser).
- Impression/click counts are approximate (bots and repeats are not filtered). Don't invoice from them without a stricter
  system.
- Mainstream ad networks (for example Google AdSense) generally prohibit sexually explicit content, so plan on direct
  sponsorships or a network that explicitly accepts adult sites. Confirm any network's rules in writing.

## Comments

Every comment is reviewed before it appears (**Moderation, Comments**). Approving one also makes it count toward its post's earnings (3 points) on the day it is approved. Approved comments can be removed from the same tab.

## Environment variables added in this step

`PAYOUT_ENCRYPTION_KEY` (64 hex chars, `openssl rand -hex 32`). Everything else is from earlier steps. The overview shows
warnings if a needed variable is missing.

## Test checklist

1. Make yourself admin; open /admin. Sign in as a second user and file a **possible minor** report on a live post.
2. The post disappears from the feed and post page; the red banner appears on every admin page; the Urgent tab opens by default.
3. **Dismiss** it: the post returns. Report again and **Take down**: media is quarantined (check /admin/quarantine).
4. File a **spam** report: it appears under Reports and the post stays visible.
5. Change the rate on /admin/settings by 50%: it is refused until you tick the confirmation.
6. Turn ads on, create a banner for "Homepage", and confirm it shows; turn ads off and confirm it disappears.
7. As a creator, add a USDT wallet and request a payout (first credit yourself on /admin/users). Process it from
   /admin/payouts; reject one and confirm the balance returns.
8. Ban a user: they can't log in, upload, post, report or buy.
