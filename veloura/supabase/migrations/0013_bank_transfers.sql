-- Manual bank transfer top-ups.
-- A reader asks to top up, gets a unique reference and your bank details, pays from their bank, and taps "I've paid".
-- An admin approves the request only after the money shows in the bank account; approval credits the wallet exactly once.
-- Approval creates a normal succeeded 'topup' payment (provider 'manual'), so wallet balances, admin stats and the
-- nightly earnings pool treat it like any other top-up. A top-up is not unlock revenue until the reader spends it.

create table bank_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles,
  reference text not null unique,
  amount_kobo int not null check (amount_kobo > 0),
  status text not null default 'pending'
    check (status in ('pending','submitted','approved','rejected','expired','cancelled')),
  sender_note text,                              -- what the reader typed to help match the transfer
  approved_amount_kobo int check (approved_amount_kobo is null or approved_amount_kobo > 0),
  review_note text,
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  payment_id uuid references payments,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on bank_transfers (status, created_at);
create index on bank_transfers (user_id, created_at desc);
alter table bank_transfers enable row level security;    -- server only, no policies

-- Settings. Bank details are never public: they are read by the server and shown only after a request is made.
insert into site_settings (key, value) values
 ('bank_enabled', 'false'),
 ('bank_name', '""'),
 ('bank_account_name', '""'),
 ('bank_account_number', '""'),
 ('bank_min_kobo', '50000'),          -- ₦500
 ('bank_max_kobo', '5000000'),        -- ₦50,000
 ('bank_expiry_hours', '24'),
 ('bank_max_pending', '3')
on conflict (key) do nothing;

create or replace function expire_bank_transfers() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- Only requests the reader never marked as paid expire on their own. A "submitted" request waits for an admin.
  update bank_transfers set status = 'expired' where status = 'pending' and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function request_bank_transfer(p_user uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_min bigint; v_max bigint; v_hours int; v_pending int; v_ref text; v_id uuid; v_exp timestamptz; i int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('bank_' || p_user::text));
  perform expire_bank_transfers();

  select coalesce((select value = 'true'::jsonb from site_settings where key = 'bank_enabled'), false) into v_on;
  if not v_on then raise exception 'bank_off'; end if;
  select coalesce((select (value #>> '{}')::bigint from site_settings where key = 'bank_min_kobo'), 50000) into v_min;
  select coalesce((select (value #>> '{}')::bigint from site_settings where key = 'bank_max_kobo'), 5000000) into v_max;
  select greatest(1, coalesce((select (value #>> '{}')::int from site_settings where key = 'bank_expiry_hours'), 24)) into v_hours;
  select greatest(1, coalesce((select (value #>> '{}')::int from site_settings where key = 'bank_max_pending'), 3)) into v_pending;

  if exists (select 1 from profiles where id = p_user and is_banned) then raise exception 'banned'; end if;
  if p_amount is null or p_amount < v_min then raise exception 'below_min'; end if;
  if p_amount > v_max then raise exception 'above_max'; end if;
  if (select count(*) from bank_transfers where user_id = p_user and status in ('pending','submitted')) >= v_pending
    then raise exception 'too_many_pending'; end if;
  if (select count(*) from bank_transfers where user_id = p_user and created_at > now() - interval '24 hours') >= 10
    then raise exception 'rate_limited'; end if;

  v_exp := now() + make_interval(hours => v_hours);
  loop
    v_ref := 'VLR-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_user::text), 1, 6));
    begin
      insert into bank_transfers (user_id, reference, amount_kobo, expires_at)
      values (p_user, v_ref, p_amount, v_exp) returning id into v_id;
      exit;
    exception when unique_violation then
      i := i + 1;
      if i > 5 then raise exception 'try_again'; end if;
    end;
  end loop;
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'expires_at', v_exp);
end $$;

-- The reader says they have paid. This does NOT credit anything; it just moves the request up the admin's list.
create or replace function mark_bank_transfer_paid(p_user uuid, p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare t bank_transfers%rowtype;
begin
  select * into t from bank_transfers where id = p_id and user_id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  if t.status not in ('pending','expired') then raise exception 'not_open'; end if;
  update bank_transfers set status = 'submitted', submitted_at = now(),
         sender_note = nullif(left(btrim(coalesce(p_note, '')), 100), '')
   where id = p_id;
end $$;

create or replace function cancel_bank_transfer(p_user uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bank_transfers set status = 'cancelled' where id = p_id and user_id = p_user and status = 'pending';
  if not found then raise exception 'not_open'; end if;
end $$;

-- Admin approves after seeing the credit alert. Credits the wallet exactly once; the amount may differ from the request.
create or replace function approve_bank_transfer(p_admin uuid, p_id uuid, p_amount bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t bank_transfers%rowtype; v_pay uuid; v_amount bigint;
begin
  select * into t from bank_transfers where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if t.status not in ('pending','submitted','expired') then raise exception 'not_open'; end if;
  v_amount := coalesce(p_amount, t.amount_kobo);
  if v_amount < 1 or v_amount > 100000000 then raise exception 'bad_amount'; end if;   -- up to ₦1,000,000
  if exists (select 1 from profiles where id = t.user_id and is_banned) then raise exception 'banned'; end if;

  insert into payments (user_id, reference, provider, method, amount_kobo, status, item_kind, confirmed_at, provider_status)
  values (t.user_id, 'bt_' || replace(t.id::text, '-', ''), 'manual', 'bank_transfer', v_amount, 'succeeded', 'topup', now(), t.reference)
  returning id into v_pay;
  perform grant_unlocks(v_pay);                                        -- credits the wallet (once per payment)

  update bank_transfers set status = 'approved', approved_amount_kobo = v_amount, review_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
         reviewed_by = p_admin, reviewed_at = now(), payment_id = v_pay
   where id = p_id;
  insert into audit_logs (actor_id, action, entity, entity_id, meta)
  values (p_admin, 'bank_transfer.approve', 'bank_transfer', p_id::text,
          jsonb_build_object('reference', t.reference, 'requested_kobo', t.amount_kobo, 'credited_kobo', v_amount, 'user_id', t.user_id));
  return jsonb_build_object('payment_id', v_pay, 'credited_kobo', v_amount);
end $$;

create or replace function reject_bank_transfer(p_admin uuid, p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare t bank_transfers%rowtype;
begin
  select * into t from bank_transfers where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if t.status not in ('pending','submitted','expired') then raise exception 'not_open'; end if;
  update bank_transfers set status = 'rejected', review_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
         reviewed_by = p_admin, reviewed_at = now()
   where id = p_id;
  insert into audit_logs (actor_id, action, entity, entity_id, meta)
  values (p_admin, 'bank_transfer.reject', 'bank_transfer', p_id::text,
          jsonb_build_object('reference', t.reference, 'requested_kobo', t.amount_kobo, 'user_id', t.user_id));
end $$;

revoke execute on function expire_bank_transfers() from public, anon, authenticated;
revoke execute on function request_bank_transfer(uuid, bigint) from public, anon, authenticated;
revoke execute on function mark_bank_transfer_paid(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function cancel_bank_transfer(uuid, uuid) from public, anon, authenticated;
revoke execute on function approve_bank_transfer(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke execute on function reject_bank_transfer(uuid, uuid, text) from public, anon, authenticated;
