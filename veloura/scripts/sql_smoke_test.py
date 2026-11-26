#!/usr/bin/env python3
"""
Runs every migration against a throwaway embedded Postgres and exercises the money, safety and security logic.
Supabase specifics (auth schema, roles, default grants) are stubbed.

    pip install pgserver psycopg2-binary
    python3 scripts/sql_smoke_test.py
"""
import glob, os, sys, tempfile, uuid
import psycopg2, psycopg2.errors, psycopg2.extras, pgserver
psycopg2.extras.register_uuid()

failures, passed = [], 0
def check(name, cond, extra=""):
    global passed
    if cond: passed += 1
    else: failures.append(f"{name} {extra}")
        
tmp = tempfile.mkdtemp()
srv = pgserver.get_server(tmp, cleanup_mode="delete")
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()
def q(sql, args=None):
    cur.execute(sql, args)
    return cur.fetchall() if cur.description else None
def one(sql, args=None):
    r = q(sql, args); return r[0][0] if r else None
def raises(sql, args, needle):
    try:
        cur.execute(sql, args); return False
    except psycopg2.Error as e:
        return needle in str(e)

# ---- Supabase stubs ----
cur.execute("""
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
""")
for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "supabase", "migrations", "*.sql"))):
    try:
        cur.execute(open(f).read()); check(f"migration {os.path.basename(f)} applies", True)
    except Exception as e:
        check(f"migration {os.path.basename(f)} applies", False, str(e)[:300]); print("\n".join(failures)); sys.exit(1)

def user(name, role="user"):
    uid = uuid.uuid4()
    cur.execute("insert into auth.users(id) values (%s)", (uid,))
    cur.execute("insert into profiles (id, username, role, age_confirmed_at, terms_accepted_at, recovery_hash) values (%s,%s,%s,now(),now(),'x')", (uid, name, role))
    return uid
A, C = user("author_a"), user("author_c")
V1, V2, V3, V4, VB, MOD = user("viewer_1"), user("viewer_2"), user("viewer_3"), user("viewer_4"), user("viewer_b"), user("mod", "admin")
cat = one("select id from categories where slug='money-tips'")
for u in (V1, V2, V3, VB): cur.execute("insert into wallet_ledger (user_id, delta_kobo, reason) values (%s, 100000, 'topup')", (u,))
bal = lambda u: one("select coalesce(sum(delta_kobo),0) from wallet_ledger where user_id=%s", (u,))

# ---- unlocks from wallet ----
one("select unlock_with_wallet(%s,'category',%s)", (V1, [cat]))
one("select unlock_with_wallet(%s,'full_pass','{}')", (V2,))
one("select unlock_with_wallet(%s,'category',%s)", (V3, [cat]))
check("wallet debited for category", bal(V1) == 100000 - 11200)
check("wallet debited for full pass", bal(V2) == 100000 - 28000)
check("rolling 24h unlock", 23.9 < one("select extract(epoch from (expires_at - starts_at))/3600 from unlocks where user_id=%s", (V1,)) < 24.1)
check("has_access true after unlock", one("select has_access(%s,%s)", (V1, cat)) is True)
check("has_access false without unlock", one("select has_access(%s,%s)", (V4, cat)) is False)
check("double unlock refused", raises("select unlock_with_wallet(%s,'category',%s)", (V1, [cat]), "already_unlocked"))
check("insufficient balance refused", raises("select unlock_with_wallet(%s,'category',%s)", (V4, [cat]), "insufficient_balance"))
cur.execute("update profiles set is_banned=true where id=%s", (VB,))
check("banned user cannot buy", raises("select unlock_with_wallet(%s,'category',%s)", (VB, [cat]), "banned"))

# ---- posts, views, reactions, comments ----
def post(author, title):
    return one("insert into posts (author_id, category_id, title, body, preview_text, status, published_at) values (%s,%s,%s,'body','teaser','approved',now()) returning id", (author, cat, title))
p1, p2, p3 = post(A, "p1"), post(C, "p2"), post(C, "p3")
for p, v in [(p1, V1), (p1, V2), (p2, V1), (p3, V3), (p1, A), (p1, VB)]: cur.execute("select record_post_view(%s,%s)", (p, v))
cur.execute("select record_post_view(%s,%s)", (p1, V1))          # same user, same day: must not double count
check("view_count counts unique viewers per day", one("select view_count from posts where id=%s", (p1,)) == 4)
one("select set_reaction(%s,%s,'like')", (V1, p1)); one("select set_reaction(%s,%s,'fire')", (V3, p3)); one("select set_reaction(%s,%s,'like')", (A, p1))
check("reaction needs access", raises("select set_reaction(%s,%s,'like')", (V4, p1), "no_access"))
one("select set_reaction(%s,%s,'love')", (V1, p1))
check("one reaction per user (kind changes)", one("select count(*) from post_reactions where post_id=%s and user_id=%s", (p1, V1)) == 1)
one("select set_reaction(%s,%s,'like')", (V1, p1))
eng = one("select post_engagement(%s,%s)", (p1, V1))
check("engagement counts", eng["like"] == 2 and eng["mine"] == "like", str(eng))
check("comment needs access", raises("select create_comment(%s,%s,'hello there')", (V4, p1), "no_access"))
check("comment too short", raises("select create_comment(%s,%s,'a')", (V2, p1), "invalid_body"))
check("comment pending first", one("select create_comment(%s,%s,'nice one')", (V2, p1)) == "pending")
check("pending comment not counted publicly", one("select post_engagement(%s,%s)", (p1, V2))["comments"] == 0)
for i in range(2): cur.execute("select create_comment(%s,%s,%s)", (V2, p1, f"more words {i}"))
check("comment rate limit per post", raises("select create_comment(%s,%s,'one too many')", (V2, p1), "rate_limited"))

# move everything onto yesterday (Lagos) and approve one comment
Y, D2 = "((now() at time zone 'Africa/Lagos')::date - 1)", "((now() at time zone 'Africa/Lagos')::date - 2)"
noon = lambda d: f"({d}::timestamp + interval '12 hours') at time zone 'Africa/Lagos'"
cur.execute(f"update post_views set view_date = {Y}")
cur.execute(f"update post_reactions set created_at = {noon(Y)}")
cur.execute(f"update comments set status='approved', approved_at = {noon(Y)} where id = (select id from comments where user_id=%s order by created_at limit 1)", (V2,))
cur.execute(f"update payments set confirmed_at = {noon(Y)} where status='succeeded'")
check("approved comment visible in counts", one("select post_engagement(%s,%s)", (p1, V2))["comments"] == 1)

# ---- earnings ----
cur.execute(f"insert into payments (user_id, reference, provider, method, amount_kobo, status, item_kind, confirmed_at) values (%s,'t_d2','wallet','wallet',12345,'succeeded','category',{noon(D2)})", (V1,))
check("cannot pay today", raises("select run_daily_earnings((now() at time zone 'Africa/Lagos')::date)", None, "day_not_finished"))
r2 = one(f"select run_daily_earnings({D2})")
check("no-interaction day carries the pool", r2["distributed_kobo"] == 0 and r2["carry_out_kobo"] == 4938, str(r2))
ry = one(f"select run_daily_earnings({Y})")
revenue = 11200 + 28000 + 11200
pool = revenue * 40 // 100 + 4938
check("pool = 40% of revenue + carry", ry["pool_kobo"] == pool, str(ry))
rows = q(f"select p.title, e.amount_kobo, e.views, e.reactions, e.comments from earnings_ledger e join posts p on p.id=e.post_id where e.earn_date={Y} order by p.title")
check("amounts add up to the pool exactly", sum(r[1] for r in rows) == pool, str(rows))
pts = {"p1": 2 * 1 + 1 * 2 + 1 * 3, "p2": 1, "p3": 1 + 2}      # author's own and banned users' activity excluded
tot = sum(pts.values())
check("weights 1/2/3 and exclusions applied", {r[0]: (r[2], r[3], r[4]) for r in rows} == {"p1": (2, 1, 1), "p2": (1, 0, 0), "p3": (1, 1, 0)}, str(rows))
check("shares proportional within 1 kobo", all(abs(r[1] - pool * pts[r[0]] / tot) < 1 for r in rows), str(rows))
check("creators credited once", one("select count(*) from creator_ledger where reason='earnings'") == 2)
check("A earns from p1 only", one("select coalesce(sum(delta_kobo),0) from creator_ledger where creator_id=%s", (A,)) == next(r[1] for r in rows if r[0] == "p1"))
check("second run is a no-op", one(f"select run_daily_earnings({Y})")["status"] == "already_run")
check("no double credit", one("select count(*) from creator_ledger where reason='earnings'") == 2)
check("nothing pending after catch-up", one("select run_pending_earnings()") == [])

# ---- payouts ----
acct = one("insert into payout_accounts (user_id,type,label,crypto_network,crypto_address_enc) values (%s,'usdt','USDT TRC20 ••••abcd','TRC20','enc') returning id", (A,))
check("payout below minimum refused", raises("select request_payout(%s,%s,1000)", (A, acct), "below_minimum"))
one("select admin_adjust_balance(%s,'creator',%s,600000,'test credit')", (MOD, A))
check("negative adjustment cannot overdraw", raises("select admin_adjust_balance(%s,'creator',%s,-99999999,'oops')", (MOD, A), "insufficient_balance"))
check("adjustment needs a note", raises("select admin_adjust_balance(%s,'creator',%s,100,' ')", (MOD, A), "note_required"))
before = one("select coalesce(sum(delta_kobo),0) from creator_ledger where creator_id=%s", (A,))
po = one("select request_payout(%s,%s,500000)", (A, acct))
check("request holds the money", one("select coalesce(sum(delta_kobo),0) from creator_ledger where creator_id=%s", (A,)) == before - 500000)
check("one payout at a time", raises("select request_payout(%s,%s,500000)", (A, acct), "payout_in_progress"))
check("reject needs a note", raises("select process_payout(%s,%s,'reject',null,'')", (MOD, po), "note_required"))
one("select process_payout(%s,%s,'reject',null,'wrong network')", (MOD, po))
check("reject returns the funds", one("select coalesce(sum(delta_kobo),0) from creator_ledger where creator_id=%s", (A,)) == before)
po2 = one("select request_payout(%s,%s,500000)", (A, acct))
check("paid needs a reference", raises("select process_payout(%s,%s,'paid','','')", (MOD, po2), "reference_required"))
one("select process_payout(%s,%s,'paid','tx123','')", (MOD, po2))
check("paid keeps funds deducted", one("select coalesce(sum(delta_kobo),0) from creator_ledger where creator_id=%s", (A,)) == before - 500000)
check("cannot process twice", raises("select process_payout(%s,%s,'reject',null,'again')", (MOD, po2), "invalid_state"))

# ---- reports, hold, takedown, quarantine ----
cur.execute("insert into post_media (post_id,type,storage_path,mime_type,size_bytes,status) values (%s,'image','m/x.jpg','image/jpeg',100,'ready')", (p1,))
check("regular report keeps post up", one("select create_report(%s,%s,'spam','x')", (V1, p1)) == "ok" and one("select held_at is null from posts where id=%s", (p1,)))
check("duplicate report ignored", one("select create_report(%s,%s,'spam','x')", (V1, p1)) == "duplicate")
check("urgent report hides the post at once", one("select create_report(%s,%s,'possible_minor',null)", (V2, p1)) == "urgent" and one("select held_at is not null from posts where id=%s", (p1,)))
check("dismiss restores the post", one("select resolve_post_reports(%s,%s,'dismiss','ok',false)", (MOD, p1)) == "dismissed" and one("select held_at is null from posts where id=%s", (p1,)))
check("reports closed after dismiss", one("select count(*) from reports where post_id=%s and status='open'", (p1,)) == 0)
one("select create_report(%s,%s,'non_consensual',null)", (V3, p1))
check("urgent takedown quarantines media", one("select resolve_post_reports(%s,%s,'takedown','removed',false)", (MOD, p1)) == "quarantined"
      and one("select status::text from post_media where post_id=%s", (p1,)) == "quarantined" and one("select status::text from posts where id=%s", (p1,)) == "removed")
check("routine takedown leaves media for deletion", one("select resolve_post_reports(%s,%s,'takedown','spam',false)", (MOD, p2)) == "removed")
check("report rate limit exists", raises("select create_report(%s,%s,'bogus',null)", (V1, p3), "invalid_reason"))

# ---- post creation with media ----
def upload(owner, kind="image", status="verified", size=1000):
    return one("insert into media_uploads (user_id, object_key, kind, mime_type, declared_size_bytes, size_bytes, mode, status, duration_ms) values (%s,%s,%s,%s,%s,%s,'single',%s,%s) returning id",
               (owner, "m/" + uuid.uuid4().hex, kind, "image/webp" if kind == "image" else "video/mp4", size, size, status, 1000 if kind == "video" else None))
u1 = upload(V1)
check("consent required", raises("select create_post_with_media(%s,%s,'t','b','p',true,false,%s)", (V1, cat, [u1]), "consent_required"))
check("cannot attach someone else's upload", raises("select create_post_with_media(%s,%s,'t','b','p',true,true,%s)", (V2, cat, [u1]), "invalid_upload"))
check("empty post refused", raises("select create_post_with_media(%s,%s,'','','',true,true,'{}')", (V1, cat), "empty_post"))
vids = [upload(V1, "video"), upload(V1, "video")]
check("only one video per post", raises("select create_post_with_media(%s,%s,'t','b','p',true,true,%s)", (V1, cat, vids), "too_much_media"))
newp = one("select create_post_with_media(%s,%s,'t','b','p',true,true,%s)", (V1, cat, [u1]))
check("post created pending with media", one("select status::text from posts where id=%s", (newp,)) == "pending" and one("select count(*) from post_media where post_id=%s", (newp,)) == 1
      and one("select status::text from media_uploads where id=%s", (u1,)) == "attached")

# ---- premium-only: nothing is free ----
check("a free post cannot exist", raises("insert into posts (author_id, category_id, title, status, is_premium) values (%s,%s,'free','approved',false)", (A, cat), "posts_premium_only"))
u2 = upload(V1)
free_try = one("select create_post_with_media(%s,%s,'t','b','p',false,true,%s)", (V1, cat, [u2]))
check("posts are always created premium", one("select is_premium from posts where id=%s", (free_try,)) is True)
p4 = post(C, "p4")
check("reaction needs an unlock on every post", raises("select set_reaction(%s,%s,'like')", (V4, p4), "no_access"))
check("comment needs an unlock on every post", raises("select create_comment(%s,%s,'hello there')", (V4, p4), "no_access"))
check("author may join their own post", one("select create_comment(%s,%s,'my own post')", (C, p4)) == "pending")

# ---- rate limiting ----
for _ in range(5): cur.execute("select auth_rl_record('login','Alice','ipX',false)")
check("5 failures lock username+device", 0 < one("select auth_rl_blocked('login','alice','ipX')") <= 900)
check("same device, other user not locked", one("select auth_rl_blocked('login','bob','ipX')") == 0)
check("same user, other device not locked", one("select auth_rl_blocked('login','alice','ipY')") == 0)
cur.execute("select auth_rl_record('login','alice','ipX',true)")
check("good login clears the lock", one("select auth_rl_blocked('login','alice','ipX')") == 0)
for i in range(20): cur.execute("select auth_rl_record('login','victim',%s,false)", (f"ip{i}",))
check("distributed guessing locks the account", one("select auth_rl_blocked('login','victim','ipNew')") > 0)
check("unknown IP skips IP rules", one("select auth_rl_blocked('login','bob',null)") == 0)
for _ in range(5): cur.execute("select auth_rl_record('recover','dan','ipR',false)")
check("recovery locked after 5 failures", one("select auth_rl_blocked('recover','dan','ipR')") > 0)
for i in range(5): cur.execute("select auth_rl_record('register',%s,'ipS',true)", (f"n{i}",))
check("registration capped per IP per day", one("select auth_rl_blocked('register','n9','ipS')") > 0)
cur.execute("select auth_rl_purge()")

# ---- admin stats ----
ov = one("select admin_overview()")
check("overview has keys", all(k in ov for k in ("users_total", "wallet_liability_kobo", "reports_urgent", "payouts_pending_kobo")), str(list(ov)))
check("overview money", ov["spend_30d_kobo"] == revenue + 12345, str(ov["spend_30d_kobo"]))
check("daily stats has 14 days", len(q("select * from admin_daily_stats(14)")) == 14)
check("user rows", len(q("select * from admin_user_rows('viewer', 30)")) == 5)

# ---- what a logged-in browser may and may not do (RLS, column grants, function grants) ----
held = one("insert into posts (author_id, category_id, title, body, status, published_at, held_at) values (%s,%s,'held','secret','approved',now(),now()) returning id", (C, cat))
def as_role(role, uid=None):
    cur.execute("reset role"); cur.execute(f"set role {role}")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid) if uid else "",))
as_role("authenticated", V1)
check("browser can read post teasers", len(q("select id, title, preview_text from posts")) >= 1)
check("browser cannot read post bodies", raises("select body from posts", None, "permission denied"))
check("browser cannot read author ids", raises("select author_id from posts", None, "permission denied"))
check("browser cannot select *", raises("select * from posts", None, "permission denied"))
check("held posts are invisible", one("select count(*) from posts where id=%s", (held,)) == 0)
check("removed posts are invisible", one("select count(*) from posts where id in (%s,%s)", (p1, p2)) == 0)
check("browser cannot read raw webhooks", raises("select raw_webhook from payments", None, "permission denied"))
check("browser sees only own payments (policy works with column grants)", one("select count(*) from payments") == 2)
check("browser cannot read payment owner column", raises("select user_id from payments", None, "permission denied"))
check("browser cannot read payout accounts", raises("select * from payout_accounts", None, "permission denied"))
check("browser cannot call unlock function", raises("select unlock_with_wallet(%s,'category',%s)", (V4, [cat]), "permission denied"))
check("browser cannot call has_access", raises("select has_access(%s,%s)", (V1, cat), "permission denied"))
check("browser cannot call earnings job", raises("select run_pending_earnings()", None, "permission denied"))
check("browser cannot read reports", one("select count(*) from reports") == 0)
check("browser cannot read comments table", one("select count(*) from comments") == 0)
check("browser cannot read upload sessions", one("select count(*) from media_uploads") == 0)
as_role("authenticated", A)
check("creator sees only own earnings", one("select count(*) from earnings_ledger where creator_id <> %s", (A,)) == 0 and one("select count(*) from earnings_ledger") >= 1)
as_role("anon")
check("anonymous visitors see no held post", one("select count(*) from posts where id=%s", (held,)) == 0)
check("anonymous visitors cannot read settings outside the public list", one("select count(*) from site_settings where key='creator_share_pct'") == 0)
cur.execute("reset role")

# ---- migration 0008: comment flags and reader reports ----
cur.execute("reset role")
cm = one("select id from comments where user_id=%s and post_id=%s order by created_at limit 1", (V2, p1))
cur.execute("update comments set status='approved', approved_at=now() where id=%s", (cm,))
check("report: logged-in reader with access can report", one("select create_comment_report(%s,%s,'spam','x')", (V1, cm)) == "ok")
check("report: non-urgent reason leaves the comment live", one("select status from comments where id=%s", (cm,)) == "approved")
check("report: same reader twice is a duplicate", one("select create_comment_report(%s,%s,'spam','x')", (V1, cm)) == "duplicate")
check("report: cannot report your own comment", raises("select create_comment_report(%s,%s,'spam','x')", (V2, cm), "own_comment"))
check("report: needs access to the category", raises("select create_comment_report(%s,%s,'spam','x')", (V4, cm), "no_access"))
check("report: bad reason refused", raises("select create_comment_report(%s,%s,'nope','x')", (V1, cm), "invalid_reason"))
cm2 = one("select id from comments where user_id=%s and post_id=%s and id<>%s order by created_at limit 1", (V2, p1, cm))
cur.execute("update comments set status='approved', approved_at=now() where id=%s", (cm2,))
check("report: urgent reason returns urgent", one("select create_comment_report(%s,%s,'possible_minor','')", (V1, cm2)) == "urgent")
check("report: urgent reason pulls the comment back to review, flagged",
      q("select status::text, flag from comments where id=%s", (cm2,))[0] == ("pending", "reported_possible_minor"))
check("report: closing reports closes open ones", one("select close_comment_reports(%s,'actioned')", (cm2,)) == 1)
check("report: reports are closed after review", one("select count(*) from comment_reports where comment_id=%s and status='open'", (cm2,)) == 0)
check("comment: flag from the pre-filter is stored", (cur.execute("select create_comment(%s,%s,'she was 16 years old','minor_terms')", (C, p4)), one("select flag from comments where user_id=%s and body='she was 16 years old'", (C,)))[1] == "minor_terms")
check("comment: no flag stays empty", (cur.execute("select create_comment(%s,%s,'plain words here')", (C, p4)), one("select flag from comments where user_id=%s and body='plain words here'", (C,)))[1] is None)
check("browser cannot call comment report function", (cur.execute("set role authenticated"), raises("select create_comment_report(%s,%s,'spam','x')", (V1, cm), "permission denied"))[1])
cur.execute("reset role")
check("browser cannot read comment reports", (cur.execute("set role authenticated"), one("select count(*) from comment_reports"))[1] == 0)
cur.execute("reset role")

# ---- migration 0009: only a user's first approved comment per post earns ----
cur.execute("reset role")
D1, D2 = "date '2020-01-10'", "date '2020-01-11'"
at = lambda d: f"(({d} + time '12:00') at time zone 'Africa/Lagos')"
for who, body, st, d in [(V2, "first by v2", "approved", D1), (V2, "second by v2", "approved", D2), (V2, "third by v2", "approved", D1),
                         (V3, "first by v3", "approved", D1),
                         (V1, "first by v1", "removed", D1), (V1, "second by v1", "approved", D2)]:
    cur.execute(f"insert into comments (post_id, user_id, body, status, approved_at) values (%s,%s,%s,%s,{at(d)})", (p4, who, body, st))
pts = lambda d: one(f"select comments from earn_points({d},1,2,3) where post_id=%s", (p4,))
check("earnings: two accounts count once each on the day of their first approval", pts(D1) == 2)
check("earnings: a later comment on another day by the same account earns nothing", pts(D2) == 0)
check("earnings: the public comment count still counts every approved comment", one("select post_engagement(%s,%s)", (p4, C))["comments"] >= 4)

# ---- migration 0010: trusted commenters ----
cur.execute("reset role")
def age():  # step past the daily comment limits
    cur.execute("update comments set created_at = created_at - interval '3 days' where user_id=%s and created_at > now() - interval '1 day'", (C,))
def setting(k, v): cur.execute("update site_settings set value = %s::jsonb where key=%s", (v, k))
cur.execute("update comments set status='rejected' where user_id=%s and status='pending'", (C,))   # start clean
cur.execute("update comments set moderated_at = now() - interval '200 days' where user_id=%s", (C,))
age()
check("trusted: setting exists and is off by default", one("select value from site_settings where key='comment_auto_approve'") is False)
check("trusted: switch off means pending", one("select create_comment(%s,%s,'hello one')", (C, p4)) == "pending"); age()
setting("comment_auto_approve", "true"); setting("comment_trust_min_approved", "2")
check("trusted: switch on but no approved history means pending", one("select create_comment(%s,%s,'hello two')", (C, p4)) == "pending"); age()
cur.execute("update comments set status='approved', approved_at=now() where user_id=%s and body in ('hello one','hello two')", (C,))
check("trusted: enough approved comments means live at once", one("select create_comment(%s,%s,'hello three')", (C, p4)) == "approved"); age()
check("trusted: auto-approved comments are marked and have an approval time",
      q("select auto_approved, approved_at is not null from comments where user_id=%s and body='hello three'", (C,))[0] == (True, True))
check("trusted: a filter flag still waits for review", one("select create_comment(%s,%s,'hello flagged','minor_terms')", (C, p4)) == "pending"); age()
cur.execute("update comments set status='rejected' where user_id=%s and body='hello flagged'", (C,))
check("trusted: a rejection sets the moderation time", one("select moderated_at is not null from comments where user_id=%s and body='hello flagged'", (C,)) is True)
check("trusted: a recent rejection sends the account back to review", one("select create_comment(%s,%s,'hello four')", (C, p4)) == "pending"); age()
cur.execute("update comments set moderated_at = now() - interval '100 days' where user_id=%s and status='rejected'", (C,))
check("trusted: after 90 days the account is trusted again", one("select create_comment(%s,%s,'hello five')", (C, p4)) == "approved"); age()
cm3 = one("select id from comments where user_id=%s and body='hello three'", (C,))
cur.execute("insert into comment_reports (comment_id, reporter_id, reason) values (%s,%s,'spam')", (cm3, V3))
check("trusted: an open report on the account's comments means review", one("select create_comment(%s,%s,'hello six')", (C, p4)) == "pending"); age()
cur.execute("update comment_reports set status='dismissed' where comment_id=%s", (cm3,))
cur.execute("update comments set status='approved', approved_at=now() where user_id=%s and body='hello six'", (C,))
check("trusted: trust returns when reports are closed", one("select create_comment(%s,%s,'hello seven')", (C, p4)) == "approved"); age()
setting("comment_auto_approve", "false")
check("trusted: switching it off stops auto-approval at once", one("select create_comment(%s,%s,'hello eight')", (C, p4)) == "pending")

# ---- migration 0011: temporary mute ----
cur.execute("reset role")
age()
cur.execute("update comments set status='rejected' where user_id=%s and status='pending'", (C,))
cur.execute("update profiles set muted_until = now() + interval '7 days' where id=%s", (C,))
check("mute: a restricted account cannot comment", raises("select create_comment(%s,%s,'muted words')", (C, p4), "muted"))
check("mute: a restricted account cannot react", raises("select set_reaction(%s,%s,'like')", (C, p4), "muted"))
check("mute: taking a reaction back is still allowed", one("select set_reaction(%s,%s,null)", (C, p4)) is not None)
cur.execute("update profiles set muted_until = 'infinity' where id=%s", (C,))
check("mute: 'until lifted' blocks too", raises("select create_comment(%s,%s,'muted words')", (C, p4), "muted"))
cur.execute("update profiles set muted_until = now() - interval '1 minute' where id=%s", (C,))
check("mute: an expired restriction no longer blocks", one("select create_comment(%s,%s,'free again')", (C, p4)) in ("pending", "approved")); age()
cur.execute("update profiles set muted_until = null, mute_reason = null where id=%s", (C,))
check("mute: lifting it restores commenting", one("select create_comment(%s,%s,'free again too')", (C, p4)) in ("pending", "approved"))

# ---- migration 0012: tips ----
cur.execute("reset role")
p4cat = one("select category_id from posts where id=%s", (p4,))
tipper = next(u for u in (V1, V2, V3, VB) if one("select has_access(%s,%s)", (u, p4cat)))
setting("tips_enabled", "true"); setting("tip_fee_pct", "10"); setting("tip_min_kobo", "10000"); setting("tip_max_kobo", "5000000"); setting("tip_daily_cap_kobo", "10000000")
rev0 = one("select count(*) from payments where item_kind in ('category','full_pass')")
w0 = bal(tipper); c0 = one("select coalesce(sum(delta_kobo),0) from creator_ledger where creator_id=%s", (C,))
r = one("select send_tip(%s,%s,20000)", (tipper, p4))
check("tip: fee and net split correctly", (r["gross_kobo"], r["fee_kobo"], r["net_kobo"]) == (20000, 2000, 18000))
check("tip: reader is debited the full amount", bal(tipper) == w0 - 20000)
check("tip: author is credited the net amount", one("select coalesce(sum(delta_kobo),0) from creator_ledger where creator_id=%s", (C,)) == c0 + 18000)
check("tip: ledger reasons are tip", one("select count(*) from wallet_ledger where user_id=%s and reason='tip'", (tipper,)) == 1
      and one("select count(*) from creator_ledger where creator_id=%s and reason='tip'", (C,)) == 1)
check("tip: never counted as unlock revenue", one("select count(*) from payments where item_kind in ('category','full_pass')") == rev0)
check("tip: below minimum refused", raises("select send_tip(%s,%s,9999)", (tipper, p4), "below_min"))
check("tip: above maximum refused", raises("select send_tip(%s,%s,5000001)", (tipper, p4), "above_max"))
check("tip: cannot tip your own post", raises("select send_tip(%s,%s,20000)", (C, p4), "own_post"))
check("tip: needs access to the category", raises("select send_tip(%s,%s,20000)", (V4, p4), "no_access"))
setting("tip_max_kobo", "999999999"); setting("tip_daily_cap_kobo", "999999999")
check("tip: cannot tip more than the wallet holds", raises("select send_tip(%s,%s,%s)", (tipper, p4, bal(tipper) + 1), "insufficient_balance"))
setting("tip_daily_cap_kobo", "30000")
check("tip: daily cap enforced", raises("select send_tip(%s,%s,20000)", (tipper, p4), "daily_cap"))
setting("tip_daily_cap_kobo", "10000000"); setting("tip_fee_pct", "0")
r0 = one("select send_tip(%s,%s,10000)", (tipper, p4))
check("tip: a 0% fee passes everything to the author", (r0["fee_kobo"], r0["net_kobo"]) == (0, 10000))
setting("tips_enabled", "false")
check("tip: switched off refuses", raises("select send_tip(%s,%s,20000)", (tipper, p4), "tips_off"))
setting("tips_enabled", "true")
cur.execute("update profiles set is_banned = true where id=%s", (C,))
check("tip: a banned creator cannot receive tips", raises("select send_tip(%s,%s,20000)", (tipper, p4), "creator_unavailable"))
cur.execute("update profiles set is_banned = false where id=%s", (C,))
check("tip: gross always equals fee plus net", one("select count(*) from tips where gross_kobo <> fee_kobo + net_kobo") == 0)
check("tip: browser cannot call send_tip", (cur.execute("set role authenticated"), raises("select send_tip(%s,%s,20000)", (tipper, p4), "permission denied"))[1])
cur.execute("reset role")
check("tip: browser cannot read the tips table", (cur.execute("set role authenticated"), one("select count(*) from tips"))[1] == 0)
cur.execute("reset role")

# ---- migration 0013: manual bank transfers ----
cur.execute("reset role")
U = V4   # a reader with nothing else going on
check("bank: switched off by default", raises("select request_bank_transfer(%s,100000)", (U,), "bank_off"))
setting("bank_enabled", "true")
check("bank: below minimum refused", raises("select request_bank_transfer(%s,49999)", (U,), "below_min"))
check("bank: above maximum refused", raises("select request_bank_transfer(%s,5000001)", (U,), "above_max"))
r1 = one("select request_bank_transfer(%s,100000)", (U,))
check("bank: request gets a reference", r1["reference"].startswith("VLR-") and len(r1["reference"]) == 10)
bt = r1["id"]
check("bank: requesting alone credits nothing", bal(U) == 0 and one("select count(*) from payments where user_id=%s", (U,)) == 0)
check("bank: another account cannot mark it paid", raises("select mark_bank_transfer_paid(%s,%s,'x')", (V3, bt), "not_found"))
cur.execute("select mark_bank_transfer_paid(%s,%s,'  John Doe  ')", (U, bt))
check("bank: marking paid moves it to submitted but credits nothing",
      q("select status, sender_note from bank_transfers where id=%s", (bt,))[0] == ("submitted", "John Doe") and bal(U) == 0)
check("bank: cannot cancel after marking paid", raises("select cancel_bank_transfer(%s,%s)", (U, bt), "not_open"))
a = one("select approve_bank_transfer(%s,%s,100000,'seen in bank')", (MOD, bt))
check("bank: approval credits the wallet", bal(U) == 100000 and a["credited_kobo"] == 100000)
check("bank: approval makes a succeeded manual top-up payment",
      q("select provider, method::text, item_kind::text, status::text, amount_kobo from payments where id=%s", (a["payment_id"],))[0] == ("manual", "bank_transfer", "topup", "succeeded", 100000))
check("bank: approving twice is refused and does not double credit", raises("select approve_bank_transfer(%s,%s,100000,'')", (MOD, bt), "not_open") and bal(U) == 100000)
check("bank: approval is audit-logged", one("select count(*) from audit_logs where action='bank_transfer.approve' and entity_id=%s", (str(bt),)) == 1)
cur.execute("select mark_bank_transfer_paid(%s,%s,'')", (U, one("select (request_bank_transfer(%s,60000))->>'id'", (U,))))
bt2 = one("select id from bank_transfers where user_id=%s and amount_kobo=60000", (U,))
a2 = one("select approve_bank_transfer(%s,%s,45000,'sent less')", (MOD, bt2))
check("bank: admin can credit a different amount", a2["credited_kobo"] == 45000 and bal(U) == 145000)
check("bank: bad amounts refused", raises("select approve_bank_transfer(%s,%s,0,'')", (MOD, one("select (request_bank_transfer(%s,50000))->>'id'", (U,))), "bad_amount"))
bt3 = one("select id from bank_transfers where user_id=%s and amount_kobo=50000", (U,))
cur.execute("select reject_bank_transfer(%s,%s,'no payment found')", (MOD, bt3))
check("bank: rejecting credits nothing", bal(U) == 145000 and one("select status from bank_transfers where id=%s", (bt3,)) == "rejected")
check("bank: a rejected request cannot be approved", raises("select approve_bank_transfer(%s,%s,50000,'')", (MOD, bt3), "not_open"))
r4 = one("select request_bank_transfer(%s,70000)", (U,)); cur.execute("select cancel_bank_transfer(%s,%s)", (U, r4["id"]))
check("bank: a reader can cancel an unpaid request", one("select status from bank_transfers where id=%s", (r4["id"],)) == "cancelled")
r5 = one("select request_bank_transfer(%s,80000)", (U,))
cur.execute("update bank_transfers set expires_at = now() - interval '1 hour' where id=%s", (r5["id"],))
check("bank: unpaid requests expire", one("select expire_bank_transfers()") >= 1 and one("select status from bank_transfers where id=%s", (r5["id"],)) == "expired")
a5 = one("select approve_bank_transfer(%s,%s,80000,'late payment')", (MOD, r5["id"]))
check("bank: a late payment can still be approved", a5["credited_kobo"] == 80000 and bal(U) == 225000)
setting("bank_max_pending", "2")
cur.execute("select request_bank_transfer(%s,50000)", (U,)); cur.execute("select request_bank_transfer(%s,50000)", (U,))
check("bank: open request limit enforced", raises("select request_bank_transfer(%s,50000)", (U,), "too_many_pending"))
cur.execute("update bank_transfers set status='cancelled' where user_id=%s and status='pending'", (U,))
setting("bank_max_pending", "3")
cur.execute("update profiles set is_banned = true where id=%s", (U,))
check("bank: a banned account cannot request", raises("select request_bank_transfer(%s,50000)", (U,), "banned"))
cur.execute("update profiles set is_banned = false where id=%s", (U,))
setting("bank_min_kobo", "100000")
check("bank: the minimum is read from the admin setting", raises("select request_bank_transfer(%s,50000)", (U,), "below_min"))
setting("bank_min_kobo", "50000"); setting("bank_enabled", "false")
check("bank: switching off stops new requests", raises("select request_bank_transfer(%s,50000)", (U,), "bank_off"))
check("bank: bank top-ups are not unlock revenue", one("select count(*) from payments where provider='manual' and item_kind in ('category','full_pass')") == 0)
cur.execute("set role authenticated")
check("bank: browser cannot call approve", raises("select approve_bank_transfer(%s,%s,1000,'')", (MOD, bt), "permission denied"))
check("bank: browser cannot read bank transfers", one("select count(*) from bank_transfers") == 0)
cur.execute("reset role")

# ---- migration 0014: credit straight from a bank alert ----
cur.execute("reset role")
setting("bank_enabled", "true")
W = V3
w0 = bal(W)
d = one("select credit_bank_transfer_direct(%s,'viewer_3',200000,'  nip/abc123 ','p2p')", (MOD,))
check("direct: credits the reader without any request", bal(W) == w0 + 200000 and d["credited_kobo"] == 200000)
check("direct: bank reference is stored uppercase and prefixed", one("select count(*) from bank_transfers where reference='EXT-NIP/ABC123' and status='approved'") == 1)
check("direct: the same bank alert cannot credit twice", raises("select credit_bank_transfer_direct(%s,'viewer_3',200000,'NIP/ABC123','')", (MOD,), "duplicate_reference") and bal(W) == w0 + 200000)
check("direct: username match ignores capitals", one("select credit_bank_transfer_direct(%s,'VIEWER_3',100,'ref-two','')", (MOD,))["credited_kobo"] == 100)
check("direct: unknown username refused", raises("select credit_bank_transfer_direct(%s,'nobody_here',1000,'ref-three','')", (MOD,), "user_not_found"))
check("direct: bad amount and bad reference refused", raises("select credit_bank_transfer_direct(%s,'viewer_3',0,'ref-four','')", (MOD,), "bad_amount")
      and raises("select credit_bank_transfer_direct(%s,'viewer_3',1000,'ab','')", (MOD,), "bad_reference"))
cur.execute("update profiles set is_banned = true where id=%s", (W,))
check("direct: a banned account cannot be credited", raises("select credit_bank_transfer_direct(%s,'viewer_3',1000,'ref-five','')", (MOD,), "banned"))
cur.execute("update profiles set is_banned = false where id=%s", (W,))
rq = one("select request_bank_transfer(%s,50000)", (W,))
before = bal(W)
d2 = one("select credit_bank_transfer_direct(%s,'someone_else',50000,%s,'')", (MOD, rq["reference"]))
check("direct: a matching open request is approved instead (right reader, no duplicate)", bal(W) == before + 50000
      and one("select status from bank_transfers where id=%s", (rq["id"],)) == "approved")
check("direct: credits create manual top-up payments", one("select count(*) from payments where provider='manual' and item_kind='topup' and user_id=%s", (W,)) >= 3)
cur.execute("set role authenticated")
check("direct: browser cannot call it", raises("select credit_bank_transfer_direct(%s,'viewer_3',1000,'ref-six','')", (MOD,), "permission denied"))
cur.execute("reset role")

print(f"\n{passed} checks passed, {len(failures)} failed")
for f in failures: print("  FAIL:", f)
sys.exit(1 if failures else 0)
