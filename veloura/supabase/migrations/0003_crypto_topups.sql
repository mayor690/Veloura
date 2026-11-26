-- Crypto top-ups (NOWPayments). Prices are in USD; NGN is derived with an admin-set rate.

alter table payments
  add column price_usd_cents    int,        -- what the customer is charged, in USD cents
  add column fx_rate            numeric,    -- NGN per 1 USD, locked when the invoice is created
  add column provider_invoice_id text,
  add column invoice_url        text,
  add column provider_status    text;
create index on payments (provider, provider_invoice_id);

-- Browsers may read their own payment rows, but not the raw provider payload.
revoke select on payments from authenticated;
grant select (id, reference, provider, method, amount_kobo, currency, status, item_kind, category_ids,
              price_usd_cents, invoice_url, provider_status, crypto_asset, created_at, confirmed_at)
  on payments to authenticated;

-- Settings. usd_ngn_rate is a PLACEHOLDER: set the real rate before launch.
insert into site_settings (key, value) values
  ('usd_ngn_rate',        '1500'),    -- NGN per 1 USD, admin-set
  ('min_topup_usd_cents', '100'),     -- floor for a single top-up ($1.00); providers enforce their own minimums
  ('max_topup_usd_cents', '20000')    -- ceiling for a single top-up ($200.00)
on conflict do nothing;

drop policy if exists "public settings" on site_settings;
create policy "public settings" on site_settings for select
  using (key in ('daily_price_kobo','full_pass_price_kobo','min_topup_kobo','usd_ngn_rate',
                 'min_topup_usd_cents','max_topup_usd_cents',
                 'ads_enabled','maintenance_mode','signups_enabled','crypto_enabled'));

-- Idempotent IPN processing. One transaction: if anything fails, the event row rolls back too,
-- so the provider's retry is processed normally.
create or replace function process_nowpayments_ipn(
  p_event_id text, p_order_id text, p_status text, p_provider_payment_id text,
  p_pay_currency text, p_tx_hash text, p_payload jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; v_rows int;
begin
  insert into webhook_events (id, provider, payload) values (p_event_id, 'nowpayments', p_payload)
  on conflict (id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return 'duplicate'; end if;

  select * into pay from payments
   where reference = p_order_id and provider = 'nowpayments' for update;
  if not found then return 'unknown_order'; end if;

  update payments set
    provider_status = p_status,
    raw_webhook     = p_payload,
    crypto_asset    = coalesce(p_pay_currency, crypto_asset),
    tx_hash         = coalesce(p_tx_hash, tx_hash)
  where id = pay.id;

  if pay.status = 'succeeded' then return 'already_succeeded'; end if;

  if p_status = 'finished' then
    update payments set status = 'succeeded', confirmed_at = now() where id = pay.id;
    perform grant_unlocks(pay.id);          -- credits wallet (topup) or grants Full Pass
    return 'credited';
  elsif p_status = 'failed' then
    update payments set status = 'failed' where id = pay.id;   return 'failed';
  elsif p_status = 'expired' then
    update payments set status = 'expired' where id = pay.id;  return 'expired';
  elsif p_status = 'refunded' then
    update payments set status = 'refunded' where id = pay.id; return 'refunded';
  end if;

  return 'noted';   -- waiting, confirming, confirmed, sending, partially_paid: stay pending, never credited
end $$;

revoke execute on function process_nowpayments_ipn(text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
