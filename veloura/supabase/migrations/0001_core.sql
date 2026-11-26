-- ENUMS
create type gender_t      as enum ('male','female','other','prefer_not_to_say');
create type role_t        as enum ('user','moderator','admin');
create type unlock_kind_t as enum ('category','full_pass');
create type pay_method_t  as enum ('card','bank_transfer','ussd','crypto','wallet');
create type pay_status_t  as enum ('pending','succeeded','failed','expired','refunded');
create type pay_item_t    as enum ('category','full_pass','topup');

-- PROFILES
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  gender gender_t not null default 'prefer_not_to_say',
  role role_t not null default 'user',
  recovery_hash text not null,
  age_confirmed_at timestamptz not null,
  terms_accepted_at timestamptz not null,
  is_banned boolean not null default false,
  ban_reason text,
  created_at timestamptz not null default now()
);

-- CATEGORIES
create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  cover_url text,
  accent text default 'purple',
  sort_order int default 0,
  price_kobo int,
  is_active boolean default true
);

-- SETTINGS
create table site_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles,
  updated_at timestamptz default now()
);

-- PAYMENTS
create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  reference text unique not null,
  provider text not null,
  method pay_method_t not null,
  amount_kobo int not null check (amount_kobo > 0),
  currency text not null default 'NGN',
  crypto_asset text, crypto_amount numeric, crypto_network text, tx_hash text,
  status pay_status_t not null default 'pending',
  item_kind pay_item_t not null,
  category_ids uuid[] not null default '{}',
  raw_webhook jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index on payments (user_id, created_at desc);

create table webhook_events (
  id text primary key,
  provider text not null,
  payload jsonb,
  processed_at timestamptz default now()
);

-- WALLET
create table wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  delta_kobo bigint not null,
  reason text not null,
  payment_id uuid references payments,
  created_at timestamptz not null default now()
);
create index on wallet_ledger (user_id);

-- UNLOCKS (rolling 24h)
create table unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  payment_id uuid not null references payments,
  kind unlock_kind_t not null,
  category_id uuid references categories,
  starts_at timestamptz not null,
  expires_at timestamptz not null
);
create index on unlocks (user_id, expires_at);
create unique index unlocks_once_per_payment
  on unlocks (payment_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'));

create or replace function has_access(p_user uuid, p_category uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from unlocks u
    where u.user_id = p_user
      and u.expires_at > now()
      and (u.kind = 'full_pass' or u.category_id = p_category)
  );
$$;

create or replace function grant_unlocks(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; cid uuid;
begin
  select * into pay from payments where id = p_payment for update;
  if pay.status <> 'succeeded' then return; end if;

  if pay.item_kind = 'full_pass' then
    insert into unlocks (user_id, payment_id, kind, starts_at, expires_at)
    values (pay.user_id, pay.id, 'full_pass', pay.confirmed_at, pay.confirmed_at + interval '24 hours')
    on conflict do nothing;
  elsif pay.item_kind = 'category' then
    foreach cid in array pay.category_ids loop
      insert into unlocks (user_id, payment_id, kind, category_id, starts_at, expires_at)
      values (pay.user_id, pay.id, 'category', cid, pay.confirmed_at, pay.confirmed_at + interval '24 hours')
      on conflict do nothing;
    end loop;
  elsif pay.item_kind = 'topup' then
    insert into wallet_ledger (user_id, delta_kobo, reason, payment_id)
    select pay.user_id, pay.amount_kobo, 'topup', pay.id
    where not exists (select 1 from wallet_ledger where payment_id = pay.id and reason = 'topup');
  end if;
end $$;

revoke execute on function grant_unlocks(uuid) from public, anon, authenticated;

-- RLS
alter table profiles       enable row level security;
alter table categories     enable row level security;
alter table site_settings  enable row level security;
alter table payments       enable row level security;
alter table unlocks        enable row level security;
alter table wallet_ledger  enable row level security;
alter table webhook_events enable row level security;

create policy "own profile read"  on profiles      for select using (id = auth.uid());
create policy "categories public" on categories    for select using (is_active);
create policy "own payments read" on payments      for select using (user_id = auth.uid());
create policy "own unlocks read"  on unlocks       for select using (user_id = auth.uid());
create policy "own wallet read"   on wallet_ledger for select using (user_id = auth.uid());
create policy "public settings"   on site_settings for select
  using (key in ('daily_price_kobo','full_pass_price_kobo','ads_enabled','maintenance_mode','signups_enabled'));

-- SEED
insert into categories (slug, name, description, sort_order) values
 ('spicy-confessions','Spicy Confessions','Anonymous, unfiltered stories',1),
 ('sex-tips','Sex Tips & Experiences','Real advice and experiences',2),
 ('relationship-tips','Marriage & Relationship Tips','Love, marriage, and everything between',3),
 ('money-tips','Money Tips & Side Hustles','Make and keep more money',4),
 ('exam-prep','Exam Prep','Study material and past-question help',5),
 ('market-prices','Market Prices','Today''s prices, market by market',6),
 ('daily-gigs','Daily Gigs / Micro Tasks','Quick tasks and paid gigs',7);

insert into site_settings (key, value) values
 ('daily_price_kobo','11200'),
 ('full_pass_price_kobo','28000'),
 ('unlock_hours','24'),
 ('ads_enabled','false'),
 ('creator_share_pct','40'),
 ('min_payout_kobo','500000'),
 ('maintenance_mode','false'),
 ('signups_enabled','true'),
 ('crypto_enabled','true'),
 ('paystack_enabled','false');
