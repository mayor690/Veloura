-- Credit a reader straight from a bank alert, with no request needed first (normal bank transfer or P2P).
-- The admin enters the reader's username, the amount received and the bank's own reference for that credit.
-- That reference is stored uniquely, so the same credit alert can never be applied twice.
-- If the reference matches an open reader request (VLR-...), that request is approved instead.

create or replace function credit_bank_transfer_direct(p_admin uuid, p_username text, p_amount bigint, p_bank_ref text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text := upper(btrim(coalesce(p_bank_ref, ''))); v_user uuid; v_n int; v_id uuid; v_pay uuid; v_open bank_transfers%rowtype;
begin
  if char_length(v_ref) < 3 or char_length(v_ref) > 60 then raise exception 'bad_reference'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then raise exception 'bad_amount'; end if;

  -- An open reader request with this reference: approve that one (keeps one record per transfer).
  select * into v_open from bank_transfers where reference = v_ref and status in ('pending','submitted','expired');
  if found then
    return approve_bank_transfer(p_admin, v_open.id, p_amount, p_note);
  end if;

  select count(*) into v_n from profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_n = 0 then raise exception 'user_not_found'; end if;
  if v_n > 1 then raise exception 'ambiguous_user'; end if;
  select id into v_user from profiles where lower(username) = lower(btrim(p_username));
  if exists (select 1 from profiles where id = v_user and is_banned) then raise exception 'banned'; end if;

  -- The unique reference is the duplicate guard: the same bank credit cannot be entered twice.
  if exists (select 1 from bank_transfers where reference = 'EXT-' || v_ref) then raise exception 'duplicate_reference'; end if;

  insert into bank_transfers (user_id, reference, amount_kobo, status, expires_at, submitted_at)
  values (v_user, 'EXT-' || v_ref, p_amount, 'pending', now(), now()) returning id into v_id;
  return approve_bank_transfer(p_admin, v_id, p_amount, coalesce(nullif(btrim(p_note), ''), 'Credited from bank alert'));
end $$;

revoke execute on function credit_bank_transfer_direct(uuid, text, bigint, text, text) from public, anon, authenticated;
