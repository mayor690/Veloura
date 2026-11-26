# Cloudflare R2 setup (all images and videos)

Veloura stores every image and video in a **private** Cloudflare R2 bucket. Supabase keeps only the database
and auth. Browsers upload **directly to R2** with short-lived presigned URLs, so large files never pass through
your server. Nothing in the bucket is ever public: readers get a signed link only after the app has checked that
they may see the post.

Secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) are environment variables. Never commit them, never use a
`NEXT_PUBLIC_` prefix, never paste them into chat or screenshots.

---

## 0. Before you rely on it

Check Cloudflare's current terms and acceptable-use policy for hosting adult user-generated content, and keep
their answer in writing (their support/sales can confirm). I have not verified this for your content. Also check
current R2 pricing and limits on their pricing page; the numbers below are the ones I confirmed when writing this.

## 1. Create the bucket

1. Cloudflare dashboard, then **R2 Object Storage**, then **Create bucket**. Name it `veloura-media`.
2. Leave it **private**. Do not enable the public `r2.dev` URL and do not attach a public custom domain.
3. Choose a location hint close to your users if offered. (Choosing the EU jurisdiction changes the endpoint, see
   `R2_ENDPOINT` in `.env.example`.)

## 2. Create an API token

1. R2 overview, then **Manage API tokens**, then **Create API token**.
2. Permission: **Object Read & Write**. Scope it to the `veloura-media` bucket only.
3. Copy the **Access Key ID** and **Secret Access Key** immediately; the secret is shown once.
4. Your **Account ID** is on the R2 overview page.

## 3. Set the CORS policy (required for browser uploads)

Bucket, then **Settings**, then **CORS Policy**, then add:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Use your real production origin (scheme and domain, no trailing slash, no path). Add preview/staging origins if
you use them. You do **not** need `GET` (images and videos load through plain `<img>`/`<video>` tags) and you do
**not** need to expose `ETag`: the server lists the uploaded parts itself.

## 4. Lifecycle rule (cheap insurance)

Bucket, then **Settings**, then **Object lifecycle rules**: add a rule that **aborts incomplete multipart uploads**
after 1 day. The app's daily cron (`/api/cron/cleanup-uploads`) also cleans abandoned uploads, so this is a
second safety net.

## 5. Environment variables

| Variable | Value |
|---|---|
| `R2_ACCOUNT_ID` | your Cloudflare account id |
| `R2_ACCESS_KEY_ID` | token access key id |
| `R2_SECRET_ACCESS_KEY` | token secret |
| `R2_BUCKET` | `veloura-media` |
| `R2_ENDPOINT` | only for EU-jurisdiction buckets |
| `CRON_SECRET` | long random string (`openssl rand -hex 32`) |

Local: put them in `.env.local`. Production (for example Vercel): add them in the project's Environment Variables
and redeploy. If any R2 variable is missing, the composer shows "Posting is unavailable" and nothing breaks.

Run `supabase/migrations/0004_media_r2.sql` (adds upload tracking, `audit_logs`, and the post-creation function).

## 6. How an upload works

```
Browser                         Next.js server                      Cloudflare R2
  |  resize/re-encode images (strips EXIF), probe video length/size    |
  |-- initUpload(kind,mime,size,...) ---> validate, create session --->|  (multipart: CreateMultipartUpload)
  |<-- single: presigned PUT   |  or multipart: {partSize, partCount}  |
  |-- getUploadParts(id) ----------> ListParts, presign missing parts->|
  |<-- presigned part URLs ----|                                       |
  |== PUT parts directly (3 in parallel, 3 retries each) =============>|  (8 MiB parts, 10 max for 80 MB)
  |-- completeUpload(id) ----------> ListParts, check sizes, Complete->|
  |                              |-- HeadObject: exact size matches? ->|
  |                              |-- read first 32 bytes: real file? ->|
  |<-- ok (status = verified) --|                                       |
  |-- createPost(uploadIds) -----> SQL function: post (pending) + media rows
  Moderator approves  ->  post goes live.   Reader opens post -> access check -> presigned GET (30 min).
```

**Resume:** if the connection drops or the page is reloaded, the browser asks the server which parts R2 already
holds (`ListParts`) and sends only the rest. The upload id is remembered per file (name, size, modified time) in
`localStorage`.

## 7. What is checked where

| Rule | Browser (UX only) | Server (enforced) |
|---|---|---|
| Format MP4 / MOV / WebM, images JPEG / PNG / WebP | yes | yes: declared type and real file bytes |
| Max 80 MB video | yes | yes: exact size read from R2 after upload |
| Max 45 seconds | yes | **not verifiable on the server** (see below) |
| Max 1080p | yes | **not verifiable on the server** |
| Vertical 9:16 preferred | warning only | no |
| Image metadata (GPS etc.) removed | yes, by re-encoding | no |
| Only the owner can attach an upload | n/a | yes |
| 18+/consent confirmation | checkbox | required by the SQL function, stored with the post |

**Duration and resolution:** the server does not decode video, so these come from the uploader's browser and could be
faked. That is why moderators must watch every video before approving, and why 80 MB and 10 parts bound the
damage. If you later need hard enforcement, add a small ffprobe step (a Cloudflare Worker, a container job, or a
processing service) before moderation. **Video metadata** (for example embedded location in a phone video) is not
stripped; tell users, or add server-side stripping with ffmpeg later.

## 8. Costs and limits to plan for

Confirmed on Cloudflare's pricing page: the free tier includes 10 GB of storage per month, 1 million Class A
(writes/lists) and 10 million Class B (reads) operations per month, and egress is free. Deleting objects and
aborting multipart uploads are free.

- A video upload costs about 13 Class A operations (create, 10 parts, list, complete, plus lists on resume), so
  operations are not the constraint. **Storage is.** Videos near 80 MB fill 10 GB after roughly 125 of them; typical
  vertical phone clips are 15 to 50 MB, so expect a few hundred. Beyond the free tier, storage is billed per GB-month.
- Rejected posts have their media deleted immediately; abandoned uploads are removed within about a day.
- Signed read links last 30 minutes. Anyone who has a link can open it until it expires, so a paying user could share
  one briefly. Shorten the TTL (`signedMediaForPost`) if that worries you.

## 9. Testing checklist

1. Run the app, register, open **New post**.
2. Add a photo: it shows a progress bar, then a check. In R2, an object appears under `m/YYYYMM/`.
3. Upload a 30 to 60 MB video: progress advances in chunks; in R2 you will see one object once it completes.
4. Start a large upload, turn off Wi-Fi mid-way, turn it back on and re-select the same file: only the missing parts
   are sent.
5. Try a 60-second video, a 100 MB video and a renamed `.txt` file: each is refused with a clear message.
6. Submit the post: it shows "In review" under **My posts**.
7. Make yourself admin (`update profiles set role='admin' where username='you'`), open `/admin/moderation`, play the
   media, approve it, then open the post as an unlocked user and confirm the media plays.
8. Reject a different test post: its objects disappear from the bucket.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser console: CORS error on upload | CORS policy missing, or the origin (scheme/domain/port) isn't listed |
| `403 SignatureDoesNotMatch` on a single PUT | Content-Type sent differs from the one signed; or the server clock is wrong |
| `501 NotImplemented` mentioning a checksum header | AWS SDK default checksums; `src/lib/r2/client.ts` already sets `WHEN_REQUIRED`. Keep that setting if you upgrade |
| "The upload couldn't be completed" on a big video | Parts of unequal size (R2 needs equal parts except the last). Don't change `PART_SIZE` while uploads are in flight |
| Upload works locally, fails in production | Production origin missing from CORS, or env vars not set in the host |
| Media doesn't load on the post page | R2 env vars missing in production, or the signed link expired (reload the page) |
