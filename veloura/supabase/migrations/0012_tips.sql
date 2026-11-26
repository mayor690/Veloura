-- Tips: a reader sends part of their wallet balance to a post's author.
-- The reader is debited the full amount, the author is credited the amount minus the platform fee, and the fee stays with the platform.
-- Tips are NOT unlock revenue, so they never feed the nightly creator pool (no double payment).
-- The author sees an anonymous tip: the tipper's identity is never shown to them.

create table tips (
  id uuid primary key default gen_random_uuid(),
  tipper_id uuid not null references profiles,
  creator_id uuid not null references profiles,
  post_id uuid not null references posts,
  gross_kobo bigint not null check (gross_kobo > 0),
  fee_kobo bigint not null check (fee_kobo >= 0),
  net_kobo bigint not null check (net_kobo > 0),
  created_at timestamptz not null default now(),
  check (gross_kobo = fee_kobo + net_kobo),
  check (tipper_id <> creator_id)
);
create index on tips (creator_id, created_at desc);
create index on tips (tipper_id, created_at desc);
create index on tips (created_at);
alter table tips enable row level security;   -- server only, no policies

insert into site_settings (key, value) values
 ('tips_enabled', 'true'),
 ('tip_fee_pct', '10'),
 ('tip_min_kobo', '10000'),          -- ₦100
 ('tip_max_kobo', '5000000'),        -- ₦50,000
 ('tip_daily_cap_kobo', '10000000')  -- ₦100,000 per reader per rolling 24 hours
on conflict (key) do nothing;

create or replace function send_tip(p_user uuid, p_post uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po posts%rowtype; v_on boolean; v_pct numeric; v_min bigint; v_max bigint; v_cap bigint;
  v_balance bigint; v_fee bigint; v_net bigint; v_sent bigint; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));      -- same lock as unlocks: one wallet change at a time

  select coalesce((select value = 'true'::jsonb from site_settings where key = 'tips_enabled'), false) into v_on;
  if not v_on then raise exception 'tips_off'; end if;

  select coalesce((select (value #>> '{}')::numeric from site_settings where key = 'tip_fee_pct'), 10) into v_pct;
  select coalesce((select (value #>> '{}')::bigint from site_settings where key = 'tip_min_kobo'), 10000) into v_min;
  select coalesce((select (value #>> '{}')::bigint from site_settings where key = 'tip_max_kobo'), 5000000) into v_max;
  select coalesce((select (value #>> '{}')::bigint from site_settings where key = 'tip_daily_cap_kobo'), 10000000) into v_cap;
  if v_pct < 0 or v_pct > 100 then raise exception 'bad_fee'; end if;

  if p_amount is null or p_amount < v_min then raise exception 'below_min'; end if;
  if p_amount > v_max then raise exception 'above_max'; end if;

  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  select * into po from posts where id = p_post and status = 'approved' and held_at is null;
  if not found then raise exception 'post_not_found'; end if;
  if po.author_id = p_user then raise exception 'own_post'; end if;
  if exists (select 1 from profiles where id = po.author_id and is_banned) then raise exception 'creator_unavailable'; end if;
  if not has_access(p_user, po.category_id) then raise exception 'no_access'; end if;

  select coalesce(sum(gross_kobo), 0) into v_sent from tips where tipper_id = p_user and created_at > now() - interval '24 hours';
  if v_sent + p_amount > v_cap then raise exception 'daily_cap'; end if;

  select coalesce(sum(delta_kobo), 0) into v_balance from wallet_ledger where user_id = p_user;
  if v_balance < p_amount then raise exception 'insufficient_balance'; end if;

  v_fee := floor(p_amount * v_pct / 100)::bigint;
  v_net := p_amount - v_fee;
  if v_net <= 0 then raise exception 'below_min'; end if;

  insert into tips (tipper_id, creator_id, post_id, gross_kobo, fee_kobo, net_kobo)
  values (p_user, po.author_id, p_post, p_amount, v_fee, v_net) returning id into v_id;
  insert into wallet_ledger (user_id, delta_kobo, reason) values (p_user, -p_amount, 'tip');
  insert into creator_ledger (creator_id, delta_kobo, reason, note) values (po.author_id, v_net, 'tip', 'Tip');

  return jsonb_build_object('id', v_id, 'gross_kobo', p_amount, 'fee_kobo', v_fee, 'net_kobo', v_net);
end $$;

revoke execute on function send_tip(uuid, uuid, bigint) from public, anon, authenticated;
