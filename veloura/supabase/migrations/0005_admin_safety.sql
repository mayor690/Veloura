-- Step 5: reports + urgent queue, takedowns, views, creator payouts, ads, admin stats.

alter type media_status_t add value if not exists 'quarantined';   -- not used inside this migration

-- ---------- posts: hold / removal ----------
alter table posts
  add column held_at timestamptz,          -- hidden pending review (set automatically by urgent reports)
  add column removed_at timestamptz,
  add column removal_reason text;

drop policy if exists "approved posts visible" on posts;
create policy "approved posts visible" on posts for select using (status = 'approved' and held_at is null);
grant select (held_at) on posts to anon, authenticated;   -- needed to evaluate the policy

alter table wallet_ledger add column note text, add column created_by uuid references profiles;

-- ---------- reports ----------
create type report_status_t as enum ('open','actioned','dismissed');

create table reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  reporter_id uuid references profiles on delete set null,
  reason text not null check (reason in ('possible_minor','non_consensual','illegal','spam','personal_info','other')),
  details text check (char_length(details) <= 1000),
  is_urgent boolean generated always as (reason in ('possible_minor','non_consensual')) stored,
  status report_status_t not null default 'open',
  handled_by uuid references profiles,
  handled_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);
create index on reports (status, is_urgent, created_at);
alter table reports enable row level security;     -- server only; reporter identity is never exposed to browsers

create or replace function create_report(p_user uuid, p_post uuid, p_reason text, p_details text)
returns text language plpgsql security definer set search_path = public as $$
declare n int; v_urgent boolean;
begin
  if p_reason not in ('possible_minor','non_consensual','illegal','spam','personal_info','other')
    then raise exception 'invalid_reason'; end if;
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  if not exists (select 1 from posts where id = p_post and status = 'approved') then raise exception 'post_not_found'; end if;
  if (select count(*) from reports where reporter_id = p_user and created_at > now() - interval '24 hours') >= 20
    then raise exception 'rate_limited'; end if;

  insert into reports (post_id, reporter_id, reason, details)
  values (p_post, p_user, p_reason, nullif(btrim(p_details), ''))
  on conflict (post_id, reporter_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'duplicate'; end if;

  v_urgent := p_reason in ('possible_minor','non_consensual');
  if v_urgent then
    -- Safety first: hide the post at once while a human reviews it.
    update posts set held_at = now() where id = p_post and held_at is null;
    insert into audit_logs (actor_id, action, entity, entity_id, meta)
    values (null, 'post.auto_hold', 'post', p_post::text, jsonb_build_object('reason', p_reason));
  end if;
  return case when v_urgent then 'urgent' else 'ok' end;
end $$;

create or replace function resolve_post_reports(p_staff uuid, p_post uuid, p_action text, p_note text, p_quarantine boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_urgent boolean;
begin
  if p_action not in ('dismiss','takedown') then raise exception 'invalid_action'; end if;
  perform 1 from posts where id = p_post for update;
  if not found then raise exception 'post_not_found'; end if;

  if p_action = 'dismiss' then
    update reports set status = 'dismissed', handled_by = p_staff, handled_at = now(), resolution = nullif(btrim(p_note), '')
      where post_id = p_post and status = 'open';
    update posts set held_at = null where id = p_post;     -- release the hold
    insert into audit_logs (actor_id, action, entity, entity_id, meta)
      values (p_staff, 'report.dismiss', 'post', p_post::text, jsonb_build_object('note', p_note));
    return 'dismissed';
  end if;

  select exists (select 1 from reports where post_id = p_post and status = 'open' and is_urgent) into v_urgent;
  v_urgent := v_urgent or coalesce(p_quarantine, false);

  update posts set status = 'removed', removed_at = now(), removal_reason = nullif(btrim(p_note), ''),
                   held_at = null, moderated_by = p_staff, moderated_at = now()
    where id = p_post;
  update reports set status = 'actioned', handled_by = p_staff, handled_at = now(), resolution = nullif(btrim(p_note), '')
    where post_id = p_post and status = 'open';
  if v_urgent then update post_media set status = 'quarantined' where post_id = p_post; end if;

  insert into audit_logs (actor_id, action, entity, entity_id, meta)
    values (p_staff, 'post.takedown', 'post', p_post::text,
            jsonb_build_object('note', p_note, 'quarantined', v_urgent));
  return case when v_urgent then 'quarantined' else 'removed' end;
end $$;

-- ---------- views (also feeds creator earnings later) ----------
create table post_views (
  post_id uuid not null references posts on delete cascade,
  viewer_id uuid not null references profiles on delete cascade,
  view_date date not null,
  primary key (post_id, viewer_id, view_date)
);
alter table post_views enable row level security;

create or replace function record_post_view(p_post uuid, p_viewer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into post_views (post_id, viewer_id, view_date)
  values (p_post, p_viewer, (now() at time zone 'Africa/Lagos')::date) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then update posts set view_count = view_count + 1 where id = p_post; end if;
end $$;

-- ---------- creator balances and payouts ----------
create type payout_status_t as enum ('requested','approved','paid','rejected');

create table creator_ledger (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles,
  delta_kobo bigint not null,
  reason text not null,                -- earnings | adjustment | payout_request | payout_rejected
  payout_id uuid,
  note text,
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);
create index on creator_ledger (creator_id, created_at desc);

create table payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  type text not null check (type in ('usdt','bank')),
  label text not null,                       -- what the creator sees, e.g. "USDT TRC20 ••••a1b2"
  bank_name text, account_name text,
  account_number_enc text,                   -- AES-256-GCM, key in PAYOUT_ENCRYPTION_KEY
  crypto_network text,
  crypto_address_enc text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles,
  account_id uuid not null references payout_accounts,
  amount_kobo bigint not null check (amount_kobo > 0),
  status payout_status_t not null default 'requested',
  processed_by uuid references profiles,
  processed_at timestamptz,
  reference text,                            -- transfer reference or tx hash entered when marked paid
  note text,
  created_at timestamptz not null default now()
);
create index on payouts (status, created_at);

alter table creator_ledger  enable row level security;
alter table payout_accounts enable row level security;
alter table payouts         enable row level security;
create policy "own creator ledger" on creator_ledger for select using (creator_id = auth.uid());
create policy "own payouts" on payouts for select using (creator_id = auth.uid());
revoke select on payout_accounts from anon, authenticated;     -- encrypted fields never reach browsers

create or replace function my_creator_balance() returns bigint language sql stable as $$
  select coalesce(sum(delta_kobo), 0) from creator_ledger where creator_id = auth.uid();
$$;

create or replace function request_payout(p_user uuid, p_account uuid, p_amount bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_min bigint; v_bal bigint; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('creator:' || p_user::text));
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  select coalesce((select (value #>> '{}')::bigint from site_settings where key = 'min_payout_kobo'), 500000) into v_min;
  if p_amount < v_min then raise exception 'below_minimum'; end if;
  if not exists (select 1 from payout_accounts where id = p_account and user_id = p_user and is_active)
    then raise exception 'invalid_account'; end if;
  if exists (select 1 from payouts where creator_id = p_user and status in ('requested','approved'))
    then raise exception 'payout_in_progress'; end if;
  select coalesce(sum(delta_kobo), 0) into v_bal from creator_ledger where creator_id = p_user;
  if v_bal < p_amount then raise exception 'insufficient_balance'; end if;

  insert into payouts (creator_id, account_id, amount_kobo) values (p_user, p_account, p_amount) returning id into v_id;
  insert into creator_ledger (creator_id, delta_kobo, reason, payout_id) values (p_user, -p_amount, 'payout_request', v_id);
  return v_id;
end $$;

create or replace function process_payout(p_staff uuid, p_payout uuid, p_action text, p_reference text, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare po payouts%rowtype;
begin
  select * into po from payouts where id = p_payout for update;
  if not found then raise exception 'payout_not_found'; end if;

  if p_action = 'approve' then
    if po.status <> 'requested' then raise exception 'invalid_state'; end if;
    update payouts set status = 'approved', processed_by = p_staff, processed_at = now() where id = po.id;
  elsif p_action = 'paid' then
    if po.status not in ('requested','approved') then raise exception 'invalid_state'; end if;
    if coalesce(btrim(p_reference), '') = '' then raise exception 'reference_required'; end if;
    update payouts set status = 'paid', processed_by = p_staff, processed_at = now(),
                       reference = btrim(p_reference), note = nullif(btrim(p_note), '') where id = po.id;
  elsif p_action = 'reject' then
    if po.status not in ('requested','approved') then raise exception 'invalid_state'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
    update payouts set status = 'rejected', processed_by = p_staff, processed_at = now(), note = btrim(p_note) where id = po.id;
    insert into creator_ledger (creator_id, delta_kobo, reason, payout_id, note)
      values (po.creator_id, po.amount_kobo, 'payout_rejected', po.id, btrim(p_note));   -- funds returned
  else
    raise exception 'invalid_action';
  end if;

  insert into audit_logs (actor_id, action, entity, entity_id, meta)
    values (p_staff, 'payout.' || p_action, 'payout', p_payout::text,
            jsonb_build_object('reference', p_reference, 'note', p_note, 'amount_kobo', po.amount_kobo));
  return p_action;
end $$;

-- Manual balance corrections (partial payments, refunds, bonuses). Always needs a note and is audited.
create or replace function admin_adjust_balance(p_admin uuid, p_target text, p_user uuid, p_delta bigint, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_target not in ('wallet','creator') then raise exception 'invalid_target'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  if p_delta = 0 then raise exception 'zero_delta'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'user_not_found'; end if;

  if p_target = 'wallet' then
    perform pg_advisory_xact_lock(hashtext(p_user::text));                 -- same key as unlock_with_wallet
    select coalesce(sum(delta_kobo), 0) into v_bal from wallet_ledger where user_id = p_user;
    if v_bal + p_delta < 0 then raise exception 'insufficient_balance'; end if;
    insert into wallet_ledger (user_id, delta_kobo, reason, note, created_by)
      values (p_user, p_delta, 'adjustment', btrim(p_note), p_admin);
  else
    perform pg_advisory_xact_lock(hashtext('creator:' || p_user::text));  -- same key as request_payout
    select coalesce(sum(delta_kobo), 0) into v_bal from creator_ledger where creator_id = p_user;
    if v_bal + p_delta < 0 then raise exception 'insufficient_balance'; end if;
    insert into creator_ledger (creator_id, delta_kobo, reason, note, created_by)
      values (p_user, p_delta, 'adjustment', btrim(p_note), p_admin);
  end if;

  insert into audit_logs (actor_id, action, entity, entity_id, meta)
    values (p_admin, 'balance.adjust', p_target, p_user::text, jsonb_build_object('delta_kobo', p_delta, 'note', p_note));
  return v_bal + p_delta;
end $$;

-- ---------- ads ----------
create table ad_slots (
  key text primary key,
  label text not null,
  is_enabled boolean not null default true
);
insert into ad_slots (key, label) values
  ('home_top', 'Homepage, under the hero'),
  ('feed_inline', 'Category feed, inline'),
  ('post_bottom', 'Post page, bottom');

create table ads (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null references ad_slots(key),
  advertiser text not null,
  title text, body text,
  image_key text,                       -- R2 key under ads/
  target_url text not null,
  starts_at timestamptz, ends_at timestamptz,
  is_active boolean not null default true,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default now()
);

create table sponsored_posts (
  id uuid primary key default gen_random_uuid(),
  advertiser text not null,
  category_id uuid references categories,      -- null = all categories
  title text not null, body text,
  image_key text,
  cta_label text not null default 'Learn more',
  cta_url text not null,
  placement_position int not null default 3 check (placement_position >= 1),
  starts_at timestamptz, ends_at timestamptz,
  is_active boolean not null default true,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default now()
);
alter table ad_slots enable row level security;
alter table ads enable row level security;
alter table sponsored_posts enable row level security;

create or replace function ad_event(p_table text, p_id uuid, p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_table = 'ads' and p_event = 'impression' then update ads set impressions = impressions + 1 where id = p_id;
  elsif p_table = 'ads' and p_event = 'click' then update ads set clicks = clicks + 1 where id = p_id;
  elsif p_table = 'sponsored_posts' and p_event = 'impression' then update sponsored_posts set impressions = impressions + 1 where id = p_id;
  elsif p_table = 'sponsored_posts' and p_event = 'click' then update sponsored_posts set clicks = clicks + 1 where id = p_id;
  end if;
end $$;

-- ---------- admin stats ----------
create or replace function admin_overview() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users_total',            (select count(*) from profiles),
    'users_7d',               (select count(*) from profiles where created_at > now() - interval '7 days'),
    'topups_30d_kobo',        (select coalesce(sum(amount_kobo), 0) from payments where status = 'succeeded' and item_kind = 'topup' and confirmed_at > now() - interval '30 days'),
    'topups_30d_usd_cents',   (select coalesce(sum(price_usd_cents), 0) from payments where status = 'succeeded' and item_kind = 'topup' and confirmed_at > now() - interval '30 days'),
    'topups_today_kobo',      (select coalesce(sum(amount_kobo), 0) from payments where status = 'succeeded' and item_kind = 'topup' and (confirmed_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date),
    'spend_30d_kobo',         (select coalesce(sum(amount_kobo), 0) from payments where status = 'succeeded' and item_kind <> 'topup' and confirmed_at > now() - interval '30 days'),
    'spend_today_kobo',       (select coalesce(sum(amount_kobo), 0) from payments where status = 'succeeded' and item_kind <> 'topup' and (confirmed_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date),
    'wallet_liability_kobo',  (select coalesce(sum(delta_kobo), 0) from wallet_ledger),
    'creator_liability_kobo', (select coalesce(sum(delta_kobo), 0) from creator_ledger),
    'active_unlocks',         (select count(*) from unlocks where expires_at > now()),
    'unlocks_30d',            (select count(*) from unlocks where starts_at > now() - interval '30 days'),
    'posts_pending',          (select count(*) from posts where status = 'pending'),
    'posts_live',             (select count(*) from posts where status = 'approved' and held_at is null),
    'reports_urgent',         (select count(distinct post_id) from reports where status = 'open' and is_urgent),
    'reports_open',           (select count(distinct post_id) from reports where status = 'open' and not is_urgent),
    'oldest_urgent_at',       (select min(created_at) from reports where status = 'open' and is_urgent),
    'payouts_pending',        (select count(*) from payouts where status in ('requested','approved')),
    'payouts_pending_kobo',   (select coalesce(sum(amount_kobo), 0) from payouts where status in ('requested','approved')),
    'payments_pending',       (select count(*) from payments where status = 'pending' and created_at > now() - interval '7 days')
  );
$$;

create or replace function admin_daily_stats(p_days int default 14)
returns table (day date, signups int, topup_kobo bigint, spend_kobo bigint, views int, unlocks int)
language sql stable security definer set search_path = public as $$
  with d as (
    select generate_series(((now() at time zone 'Africa/Lagos')::date - (p_days - 1))::timestamp,
                           (now() at time zone 'Africa/Lagos')::date::timestamp, interval '1 day')::date as day
  )
  select d.day,
    (select count(*) from profiles p where (p.created_at at time zone 'Africa/Lagos')::date = d.day)::int,
    coalesce((select sum(x.amount_kobo) from payments x where x.status = 'succeeded' and x.item_kind = 'topup'
              and (x.confirmed_at at time zone 'Africa/Lagos')::date = d.day), 0)::bigint,
    coalesce((select sum(x.amount_kobo) from payments x where x.status = 'succeeded' and x.item_kind <> 'topup'
              and (x.confirmed_at at time zone 'Africa/Lagos')::date = d.day), 0)::bigint,
    (select count(*) from post_views v where v.view_date = d.day)::int,
    (select count(*) from unlocks u where (u.starts_at at time zone 'Africa/Lagos')::date = d.day)::int
  from d order by d.day;
$$;

create or replace function admin_user_rows(p_q text, p_limit int default 30)
returns table (id uuid, username text, role role_t, is_banned boolean, ban_reason text, created_at timestamptz,
               posts bigint, wallet_kobo bigint, creator_kobo bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.role, p.is_banned, p.ban_reason, p.created_at,
         (select count(*) from posts x where x.author_id = p.id),
         (select coalesce(sum(delta_kobo), 0) from wallet_ledger w where w.user_id = p.id),
         (select coalesce(sum(delta_kobo), 0) from creator_ledger c where c.creator_id = p.id)
  from profiles p
  where coalesce(p_q, '') = '' or p.username ilike '%' || p_q || '%'
  order by p.created_at desc limit least(p_limit, 100);
$$;

-- ---------- replace earlier functions: configurable unlock hours, banned users cannot buy ----------
create or replace function grant_unlocks(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; cid uuid; v_hours int;
begin
  select (value #>> '{}')::int into v_hours from site_settings where key = 'unlock_hours';
  if v_hours is null or v_hours < 1 then v_hours := 24; end if;

  select * into pay from payments where id = p_payment for update;
  if pay.status <> 'succeeded' then return; end if;

  if pay.item_kind = 'full_pass' then
    insert into unlocks (user_id, payment_id, kind, starts_at, expires_at)
    values (pay.user_id, pay.id, 'full_pass', pay.confirmed_at, pay.confirmed_at + make_interval(hours => v_hours))
    on conflict do nothing;
  elsif pay.item_kind = 'category' then
    foreach cid in array pay.category_ids loop
      insert into unlocks (user_id, payment_id, kind, category_id, starts_at, expires_at)
      values (pay.user_id, pay.id, 'category', cid, pay.confirmed_at, pay.confirmed_at + make_interval(hours => v_hours))
      on conflict do nothing;
    end loop;
  elsif pay.item_kind = 'topup' then
    insert into wallet_ledger (user_id, delta_kobo, reason, payment_id)
    select pay.user_id, pay.amount_kobo, 'topup', pay.id
    where not exists (select 1 from wallet_ledger where payment_id = pay.id and reason = 'topup');
  end if;
end $$;

create or replace function unlock_with_wallet(p_user uuid, p_kind pay_item_t, p_category_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_daily int; v_pass int; v_total int; v_balance bigint; v_pay uuid; cid uuid;
begin
  if p_kind = 'topup' then raise exception 'invalid_kind'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;

  select (value #>> '{}')::int into v_daily from site_settings where key = 'daily_price_kobo';
  select (value #>> '{}')::int into v_pass  from site_settings where key = 'full_pass_price_kobo';

  if p_kind = 'full_pass' then
    p_category_ids := '{}';
    if exists (select 1 from unlocks where user_id = p_user and kind = 'full_pass' and expires_at > now())
      then raise exception 'already_unlocked'; end if;
    v_total := v_pass;
  else
    if coalesce(array_length(p_category_ids, 1), 0) = 0 then raise exception 'no_categories'; end if;
    if (select count(*) from categories where id = any(p_category_ids) and is_active)
       <> array_length(p_category_ids, 1) then raise exception 'invalid_category'; end if;
    foreach cid in array p_category_ids loop
      if has_access(p_user, cid) then raise exception 'already_unlocked'; end if;
    end loop;
    select sum(coalesce(price_kobo, v_daily)) into v_total from categories where id = any(p_category_ids);
  end if;

  select coalesce(sum(delta_kobo), 0) into v_balance from wallet_ledger where user_id = p_user;
  if v_balance < v_total then raise exception 'insufficient_balance'; end if;

  insert into payments (user_id, reference, provider, method, amount_kobo, status,
                        item_kind, category_ids, confirmed_at)
  values (p_user, 'wal_' || replace(gen_random_uuid()::text, '-', ''), 'wallet', 'wallet',
          v_total, 'succeeded', p_kind, p_category_ids, now())
  returning id into v_pay;

  insert into wallet_ledger (user_id, delta_kobo, reason, payment_id) values (p_user, -v_total, 'unlock', v_pay);
  perform grant_unlocks(v_pay);
  return v_pay;
end $$;

-- ---------- lock down server-only functions ----------
revoke execute on function create_report(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function resolve_post_reports(uuid,uuid,text,text,boolean) from public, anon, authenticated;
revoke execute on function record_post_view(uuid,uuid) from public, anon, authenticated;
revoke execute on function request_payout(uuid,uuid,bigint) from public, anon, authenticated;
revoke execute on function process_payout(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke execute on function admin_adjust_balance(uuid,text,uuid,bigint,text) from public, anon, authenticated;
revoke execute on function ad_event(text,uuid,text) from public, anon, authenticated;
revoke execute on function admin_overview() from public, anon, authenticated;
revoke execute on function admin_daily_stats(int) from public, anon, authenticated;
revoke execute on function admin_user_rows(text,int) from public, anon, authenticated;
revoke execute on function grant_unlocks(uuid) from public, anon, authenticated;
revoke execute on function unlock_with_wallet(uuid, pay_item_t, uuid[]) from public, anon, authenticated;
