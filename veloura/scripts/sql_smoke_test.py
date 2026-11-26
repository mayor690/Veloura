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

print(f"\n{passed} checks passed, {len(failures)} failed")
for f in failures: print("  FAIL:", f)
sys.exit(1 if failures else 0)
