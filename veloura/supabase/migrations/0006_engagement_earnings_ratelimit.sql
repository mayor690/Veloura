-- Step 6: reactions and comments, nightly creator earnings, auth rate limiting.

insert into site_settings (key, value) values
  ('weight_view', '1'), ('weight_reaction', '2'), ('weight_comment', '3')
on conflict do nothing;

-- ---------- reactions and comments ----------
create type comment_status_t as enum ('pending','approved','rejected','removed');

create table post_reactions (
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  kind text not null check (kind in ('like','love','fire')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)               -- one reaction per user per post (the kind can change)
);
create index on post_reactions (created_at);

create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  body text not null check (char_length(body) between 2 and 1000),
  status comment_status_t not null default 'pending',     -- every comment is reviewed before it is visible
  approved_at timestamptz,
  moderated_by uuid references profiles,
  created_at timestamptz not null default now()
);
create index on comments (post_id, status, created_at);
create index on comments (status, created_at);
alter table post_reactions enable row level security;    -- server only
alter table comments enable row level security;

create or replace function post_engagement(p_post uuid, p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'like',     (select count(*) from post_reactions where post_id = p_post and kind = 'like'),
    'love',     (select count(*) from post_reactions where post_id = p_post and kind = 'love'),
    'fire',     (select count(*) from post_reactions where post_id = p_post and kind = 'fire'),
    'mine',     (select kind from post_reactions where post_id = p_post and user_id = p_user),
    'comments', (select count(*) from comments where post_id = p_post and status = 'approved')
  );
$$;

-- Only people who can see a premium post (unlocked it) may react or comment. The author may take part but earns nothing from it.
create or replace function set_reaction(p_user uuid, p_post uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po posts%rowtype;
begin
  select * into po from posts where id = p_post and status = 'approved' and held_at is null;
  if not found then raise exception 'post_not_found'; end if;
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  if po.is_premium and po.author_id <> p_user and not has_access(p_user, po.category_id) then raise exception 'no_access'; end if;

  if p_kind is null then
    delete from post_reactions where post_id = p_post and user_id = p_user;
  else
    if p_kind not in ('like','love','fire') then raise exception 'invalid_kind'; end if;
    insert into post_reactions (post_id, user_id, kind) values (p_post, p_user, p_kind)
    on conflict (post_id, user_id) do update set kind = excluded.kind;      -- created_at is kept, so switching kinds earns nothing extra
  end if;
  return post_engagement(p_post, p_user);
end $$;

create or replace function create_comment(p_user uuid, p_post uuid, p_body text)
returns text language plpgsql security definer set search_path = public as $$
declare po posts%rowtype; v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 2 or char_length(v_body) > 1000 then raise exception 'invalid_body'; end if;
  select * into po from posts where id = p_post and status = 'approved' and held_at is null;
  if not found then raise exception 'post_not_found'; end if;
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  if po.is_premium and po.author_id <> p_user and not has_access(p_user, po.category_id) then raise exception 'no_access'; end if;

  if (select count(*) from comments where post_id = p_post and user_id = p_user and created_at > now() - interval '24 hours') >= 3
    then raise exception 'rate_limited'; end if;
  if (select count(*) from comments where user_id = p_user and created_at > now() - interval '24 hours') >= 20
    then raise exception 'rate_limited'; end if;
  if (select count(*) from comments where user_id = p_user and status = 'pending') >= 5
    then raise exception 'too_many_pending'; end if;

  insert into comments (post_id, user_id, body) values (p_post, p_user, v_body);
  return 'pending';
end $$;

-- ---------- earnings ----------
create table earnings_runs (
  earn_date date primary key,                  -- the Lagos calendar day that was paid out
  revenue_kobo bigint not null,                -- unlock revenue that day
  share_pct numeric not null,
  carry_in_kobo bigint not null,               -- unpaid pool carried from earlier days
  pool_kobo bigint not null,                   -- floor(revenue * share) + carry_in
  distributed_kobo bigint not null,
  carry_out_kobo bigint not null,              -- pool left over when nobody earned points that day
  total_points numeric not null,
  weight_view int not null, weight_reaction int not null, weight_comment int not null,
  ran_at timestamptz not null default now()
);

create table earnings_ledger (
  id uuid primary key default gen_random_uuid(),
  earn_date date not null,
  post_id uuid references posts on delete set null,
  creator_id uuid not null references profiles,
  views int not null, reactions int not null, comments int not null,
  points numeric not null,
  amount_kobo bigint not null,
  unique (earn_date, post_id)
);
create index on earnings_ledger (creator_id, earn_date desc);
alter table earnings_runs   enable row level security;
alter table earnings_ledger enable row level security;
create policy "own earnings" on earnings_ledger for select using (creator_id = auth.uid());

-- one earnings credit per creator per day, even if a job were ever re-run
create unique index creator_earnings_once on creator_ledger (creator_id, note) where reason = 'earnings';

-- Weighted interaction points per post for one Lagos day. Authors' own activity and banned users never count.
create or replace function earn_points(p_date date, wv int, wr int, wc int)
returns table (post_id uuid, creator_id uuid, views int, reactions int, comments int, points numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.author_id, v.n::int, r.n::int, c.n::int, (v.n * wv + r.n * wr + c.n * wc)::numeric
  from posts p
  join profiles a on a.id = p.author_id and not a.is_banned
  cross join lateral (
    select count(*) as n from post_views pv join profiles u on u.id = pv.viewer_id
    where pv.post_id = p.id and pv.view_date = p_date and pv.viewer_id <> p.author_id and not u.is_banned) v
  cross join lateral (
    select count(*) as n from post_reactions x join profiles u on u.id = x.user_id
    where x.post_id = p.id and (x.created_at at time zone 'Africa/Lagos')::date = p_date
      and x.user_id <> p.author_id and not u.is_banned) r
  cross join lateral (
    select count(*) as n from comments cm join profiles u on u.id = cm.user_id
    where cm.post_id = p.id and cm.status = 'approved' and (cm.approved_at at time zone 'Africa/Lagos')::date = p_date
      and cm.user_id <> p.author_id and not u.is_banned) c
  where p.status = 'approved' and p.held_at is null;
$$;

-- Pays out one finished Lagos day. Safe to call twice: a second call does nothing.
create or replace function run_daily_earnings(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pct numeric; v_wv int; v_wr int; v_wc int;
  v_revenue bigint; v_carry_in bigint := 0; v_pool bigint; v_total numeric; v_distributed bigint := 0;
  v_prev_carry bigint;
begin
  perform pg_advisory_xact_lock(hashtext('earnings_run'));
  if exists (select 1 from earnings_runs where earn_date = p_date) then
    return jsonb_build_object('date', p_date, 'status', 'already_run');
  end if;
  if p_date >= (now() at time zone 'Africa/Lagos')::date then raise exception 'day_not_finished'; end if;

  select coalesce((select (value #>> '{}')::numeric from site_settings where key = 'creator_share_pct'), 40) into v_pct;
  select coalesce((select (value #>> '{}')::int from site_settings where key = 'weight_view'), 1) into v_wv;
  select coalesce((select (value #>> '{}')::int from site_settings where key = 'weight_reaction'), 2) into v_wr;
  select coalesce((select (value #>> '{}')::int from site_settings where key = 'weight_comment'), 3) into v_wc;
  if v_pct < 0 or v_pct > 100 then raise exception 'bad_share'; end if;

  select carry_out_kobo into v_prev_carry from earnings_runs where earn_date < p_date order by earn_date desc limit 1;
  v_carry_in := coalesce(v_prev_carry, 0);

  -- Revenue = money actually spent on unlocks that day (wallet spend and direct crypto passes). Top-ups are not revenue until spent.
  select coalesce(sum(amount_kobo), 0) into v_revenue from payments
   where status = 'succeeded' and item_kind in ('category', 'full_pass')
     and (confirmed_at at time zone 'Africa/Lagos')::date = p_date;
  v_pool := floor(v_revenue * v_pct / 100)::bigint + v_carry_in;

  select coalesce(sum(points), 0) into v_total from earn_points(p_date, v_wv, v_wr, v_wc);

  if v_total > 0 and v_pool > 0 then
    -- Largest-remainder split so the posts' amounts add up to the pool exactly, to the kobo.
    with pts as (select * from earn_points(p_date, v_wv, v_wr, v_wc) where points > 0),
    raw as (select pts.*, v_pool * pts.points / v_total as exact from pts),
    base as (select raw.*, floor(raw.exact)::bigint as fl, raw.exact - floor(raw.exact) as frac from raw),
    ranked as (
      select base.*, row_number() over (order by frac desc, post_id) as rn,
             (v_pool - sum(fl) over ())::bigint as leftover
      from base)
    insert into earnings_ledger (earn_date, post_id, creator_id, views, reactions, comments, points, amount_kobo)
    select p_date, post_id, creator_id, views, reactions, comments, points,
           fl + case when rn <= leftover then 1 else 0 end
    from ranked;

    insert into creator_ledger (creator_id, delta_kobo, reason, note)
    select creator_id, sum(amount_kobo), 'earnings', 'earnings:' || p_date::text
    from earnings_ledger where earn_date = p_date group by creator_id having sum(amount_kobo) > 0;

    select coalesce(sum(amount_kobo), 0) into v_distributed from earnings_ledger where earn_date = p_date;
  end if;

  insert into earnings_runs (earn_date, revenue_kobo, share_pct, carry_in_kobo, pool_kobo, distributed_kobo, carry_out_kobo,
                             total_points, weight_view, weight_reaction, weight_comment)
  values (p_date, v_revenue, v_pct, v_carry_in, v_pool, v_distributed, v_pool - v_distributed, v_total, v_wv, v_wr, v_wc);

  insert into audit_logs (actor_id, action, entity, entity_id, meta)
  values (null, 'earnings.run', 'earnings', p_date::text,
          jsonb_build_object('revenue_kobo', v_revenue, 'pool_kobo', v_pool, 'distributed_kobo', v_distributed));

  return jsonb_build_object('date', p_date, 'status', 'ran', 'revenue_kobo', v_revenue, 'pool_kobo', v_pool,
                            'distributed_kobo', v_distributed, 'carry_out_kobo', v_pool - v_distributed);
end $$;

-- Catches up any finished days that have not been paid (never more than 7 back; starts at yesterday on the first run).
create or replace function run_pending_earnings()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last date; v_day date; v_yest date := (now() at time zone 'Africa/Lagos')::date - 1; v_out jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('earnings_run'));
  select max(earn_date) into v_last from earnings_runs;
  v_day := coalesce(v_last + 1, v_yest);
  if v_day < v_yest - 6 then v_day := v_yest - 6; end if;
  while v_day <= v_yest loop
    v_out := v_out || jsonb_build_array(run_daily_earnings(v_day));
    v_day := v_day + 1;
  end loop;
  return v_out;
end $$;

-- ---------- auth rate limiting (works across serverless instances because it lives in the database) ----------
create table auth_attempts (
  id bigserial primary key,
  kind text not null check (kind in ('login','recover','register')),
  username text not null,
  ip_hash text,                                 -- HMAC of the IP; the raw IP is never stored
  success boolean not null,
  created_at timestamptz not null default now()
);
create index on auth_attempts (kind, created_at);
create index on auth_attempts (kind, username, created_at);
create index on auth_attempts (kind, ip_hash, created_at);
alter table auth_attempts enable row level security;

create or replace function rl_wait(p_kind text, p_scope text, p_username text, p_ip text, p_window interval, p_max int, p_filter text)
returns int language plpgsql stable security definer set search_path = public as $$
declare v_n int; v_oldest timestamptz;
begin
  if p_scope in ('pair','ip') and p_ip is null then return 0; end if;   -- unknown IP: skip IP-based rules
  select count(*), min(created_at) into v_n, v_oldest from auth_attempts
   where kind = p_kind and created_at > now() - p_window
     and (p_filter = 'any' or (p_filter = 'fail' and not success) or (p_filter = 'success' and success))
     and (p_scope <> 'pair' or (username = p_username and ip_hash = p_ip))
     and (p_scope <> 'user' or username = p_username)
     and (p_scope <> 'ip' or ip_hash = p_ip);
  if v_n < p_max then return 0; end if;
  return greatest(1, ceil(extract(epoch from (v_oldest + p_window - now())))::int);
end $$;

-- Seconds the caller must wait, or 0 if the attempt may go ahead.
create or replace function auth_rl_blocked(p_kind text, p_username text, p_ip text)
returns int language plpgsql stable security definer set search_path = public as $$
declare u text := lower(btrim(p_username));
begin
  if p_kind = 'login' then
    return greatest(
      rl_wait('login', 'pair', u, p_ip, interval '15 minutes', 5, 'fail'),     -- 5 wrong passwords per username+device
      rl_wait('login', 'user', u, p_ip, interval '1 hour', 20, 'fail'),        -- spread-out guessing against one account
      rl_wait('login', 'ip',   u, p_ip, interval '15 minutes', 30, 'fail'));   -- one device trying many accounts
  elsif p_kind = 'recover' then
    return greatest(
      rl_wait('recover', 'pair', u, p_ip, interval '1 hour', 5, 'fail'),
      rl_wait('recover', 'user', u, p_ip, interval '24 hours', 15, 'fail'),
      rl_wait('recover', 'ip',   u, p_ip, interval '1 hour', 20, 'fail'));
  elsif p_kind = 'register' then
    return greatest(
      rl_wait('register', 'ip', u, p_ip, interval '1 hour', 15, 'any'),       -- any attempts
      rl_wait('register', 'ip', u, p_ip, interval '24 hours', 5, 'success'));  -- accounts actually created
  end if;
  return 0;
end $$;

create or replace function auth_rl_record(p_kind text, p_username text, p_ip text, p_success boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into auth_attempts (kind, username, ip_hash, success) values (p_kind, lower(btrim(p_username)), p_ip, p_success);
  if p_success and p_kind in ('login','recover') then   -- a good login clears that username+device's failures
    delete from auth_attempts where kind = p_kind and username = lower(btrim(p_username)) and ip_hash is not distinct from p_ip and not success;
  end if;
end $$;

create or replace function auth_rl_purge() returns void language sql security definer set search_path = public as $$
  delete from auth_attempts where created_at < now() - interval '2 days';
$$;

-- ---------- lock down server-only functions ----------
revoke execute on function has_access(uuid,uuid) from public, anon, authenticated;   -- only the server asks this, never a browser
revoke execute on function post_engagement(uuid,uuid) from public, anon, authenticated;
revoke execute on function set_reaction(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function create_comment(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function earn_points(date,int,int,int) from public, anon, authenticated;
revoke execute on function run_daily_earnings(date) from public, anon, authenticated;
revoke execute on function run_pending_earnings() from public, anon, authenticated;
revoke execute on function rl_wait(text,text,text,text,interval,int,text) from public, anon, authenticated;
revoke execute on function auth_rl_blocked(text,text,text) from public, anon, authenticated;
revoke execute on function auth_rl_record(text,text,text,boolean) from public, anon, authenticated;
revoke execute on function auth_rl_purge() from public, anon, authenticated;
