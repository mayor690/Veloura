# Veloura architecture

| Concern | Technology |
|---|---|
| Web app | Next.js 15 (App Router), TypeScript, Tailwind v4 |
| Database, auth | Supabase (Postgres, Row Level Security, Auth) |
| Images and videos | **Cloudflare R2** (private bucket, presigned URLs, multipart uploads) |
| Payments | NOWPayments (USDT/USDC) into a wallet balance; Paystack later if approved |

**Premium-only:** there is no free content. Every post needs an active unlock to open, react or comment (authors can open their own). Posting is open to any account (no unlock needed; it is moderated before publishing). Anyone can browse category names and post titles; summaries, bodies and media are never sent to someone who hasn't paid.

Supabase Storage is **not used**. Postgres stores only object keys and upload sessions, never file bytes.

## Folder structure

```
veloura/
├── docs/                      ARCHITECTURE.md, NOWPAYMENTS_SETUP.md, R2_SETUP.md, ADMIN_AND_SAFETY.md, EARNINGS.md, LAUNCH_CHECKLIST.md
├── supabase/migrations/       0001 core, 0002 posts+wallet unlock, 0003 crypto top-ups, 0004 R2 media, 0005 admin+safety, 0006 engagement+earnings+rate limits
├── vercel.json                daily cron: cleanup of abandoned uploads
└── src/
    ├── middleware.ts          session refresh, 18+ gate, auth guard (skips /api/webhooks, /api/cron)
    ├── app/
    │   ├── age-gate/
    │   ├── (public)/          homepage, c/[slug] feed, p/[id] post (access check + signed media)
    │   ├── (auth)/            register, login, recover
    │   ├── (user)/dashboard/  overview, create (composer), my-posts, earnings (payout accounts + requests)
    │   ├── (admin)/admin/     layout (staff guard + urgent banner), overview, moderation (urgent/reports/new/live),
    │   │                      users, payments, payouts, ads, sponsored, settings, quarantine, audit
    │   ├── checkout/          topup, status/[reference], actions (create NOWPayments invoice)
    │   ├── media/actions.ts   initUpload, getUploadParts, completeUpload, abortUpload
    │   └── api/
    │       ├── webhooks/crypto/        NOWPayments IPN (signature-verified, idempotent)
    │       ├── payments/status/        payment polling
    │       ├── ads/{impression,click,img}/  ad tracking, click redirect, creative images
    │       ├── cron/daily-earnings/    nightly creator earnings (00:30 Lagos)
    │       └── health/                 uptime check
    │       └── cron/cleanup-uploads/   abandoned-upload cleanup
    ├── components/
    │   ├── media/    MediaUploader, VideoRecorder, MediaGallery
    │   ├── feed/     PostCard, LockedOverlay, PostComposer
    │   ├── payments/ UnlockModal, TopupForm, PaymentStatus
    │   ├── home/  layout/  auth/  ui/
    └── lib/
        ├── r2/        client.ts (S3 client for R2), storage.ts (presign, multipart, head, sniff-read, delete), media.ts (signed URLs per post)
        ├── media/     limits.ts (shared rules), sniff.ts (file-type check), image.ts, video.ts, uploader.ts (browser multipart + resume)
        ├── payments/  fx.ts, ipn.ts, nowpayments.ts, settings.ts, provider.ts
        ├── supabase/  client, server, admin (service role, server only)
        └── admin-guard.ts, auth.ts, viewer.ts, settings.ts, constants.ts
```

## Media data model

- `media_uploads`: one row per upload session (owner, random R2 key, declared and confirmed size, multipart upload id,
  status `initiated`, `verified`, `attached`, `aborted`, `rejected`). Server-only (no RLS policies).
- `post_media`: the media attached to a post. `storage_path` holds the **R2 object key**, never a URL.
- Object keys are random (`m/YYYYMM/<uuid>.<ext>`) and contain no user id, post id or filename.
- `create_post_with_media()` (SQL) creates the post and its media atomically and refuses unverified or foreign uploads.

## Access model

1. Nothing in R2 is public.
2. Locked posts: the browser receives only title and teaser. `posts.body` and `author_id` are not readable from the
   browser (column grants).
3. Opening a post: the server checks `has_access()` (rolling 24 h unlock), then reads the body and generates 30-minute
   presigned R2 URLs.
4. Moderators get presigned URLs for pending posts through the staff-only admin page.

## Safety and money model (Step 5)

- `reports` (server-only) with `is_urgent` generated from the reason. An urgent report sets `posts.held_at`, which the
  public RLS policy treats as hidden. `resolve_post_reports()` dismisses (restores) or takes down (deletes or quarantines media).
- Money is ledger-based: `wallet_ledger` (user credit), `creator_ledger` (creator earnings, payout holds and returns),
  `payments`, `payouts`. Balances are sums of ledger rows; every manual change goes through `admin_adjust_balance()`
  with a note and an audit entry.
- Payout destinations are encrypted (`lib/crypto-box.ts`) and only decrypted on the admin payout page, with an audit entry.
- Roles: `user`, `moderator`, `admin`. Moderators handle content; admins handle people, money, ads and settings.

## Engagement, earnings, rate limiting (Step 6)

- `post_reactions` (one per user per post), `comments` (always pre-moderated). Only users who unlocked a premium post
  can react or comment, enforced in SQL (`set_reaction`, `create_comment`).
- `run_daily_earnings(date)` / `run_pending_earnings()`: weighted points (view 1, reaction 2, approved comment 3) split
  the creator share of the day's unlock revenue; exact-to-the-kobo allocation; carry-over when nobody scored; idempotent.
- `auth_attempts` + `auth_rl_blocked/record`: database-backed rate limits for login, recovery and registration, so they work
  across serverless instances. IPs are stored only as a keyed hash.
- `scripts/sql_smoke_test.py` runs all migrations on a throwaway Postgres and checks money, safety and permissions.
