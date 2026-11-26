insert into site_settings (key, value) values ('min_topup_kobo', '50000') on conflict do nothing;

drop policy if exists "public settings" on site_settings;
create policy "public settings" on site_settings for select
  using (key in ('daily_price_kobo','full_pass_price_kobo','min_topup_kobo',
                 'ads_enabled','maintenance_mode','signups_enabled','crypto_enabled'));

create type post_status_t  as enum ('draft','pending','approved','rejected','removed');
create type media_type_t   as enum ('image','video');
create type media_status_t as enum ('uploading','processing','ready','failed');

create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles on delete cascade,
  category_id uuid not null references categories,
  title text,
  body text,
  is_premium boolean not null default true,
  preview_text text,
  status post_status_t not null default 'pending',
  rejection_reason text,
  moderated_by uuid references profiles,
  moderated_at timestamptz,
  published_at timestamptz,
  view_count int not null default 0,
  created_at timestamptz not null default now()
);
create index on posts (category_id, status, published_at desc);

create table post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  type media_type_t not null,
  storage_path text not null,
  thumbnail_path text,
  mime_type text not null,
  size_bytes bigint not null,
  duration_ms int,
  width int, height int,
  status media_status_t not null default 'uploading',
  sort_order int default 0,
  check (type <> 'video' or (size_bytes <= 83886080 and duration_ms <= 45000))
);

alter table posts      enable row level security;
alter table post_media enable row level security;

create policy "approved posts visible" on posts for select using (status = 'approved');

-- Body and author_id are never readable from the browser.
revoke select on posts from anon, authenticated;
grant select (id, category_id, title, preview_text, is_premium, status,
              published_at, view_count, created_at) on posts to anon, authenticated;

create or replace function my_wallet_balance()
returns bigint language sql stable as $$
  select coalesce(sum(delta_kobo), 0) from wallet_ledger where user_id = auth.uid();
$$;

create or replace function unlock_with_wallet(p_user uuid, p_kind pay_item_t, p_category_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_daily int; v_pass int; v_total int; v_balance bigint; v_pay uuid; cid uuid;
begin
  if p_kind = 'topup' then raise exception 'invalid_kind'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text));

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

revoke execute on function unlock_with_wallet(uuid, pay_item_t, uuid[]) from public, anon, authenticated;
