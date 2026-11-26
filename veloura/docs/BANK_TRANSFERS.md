# Manual bank transfer top-ups

Readers can top up their wallet by sending a bank transfer to your account. You approve each one after the money arrives.
Needs `supabase/migrations/0013_bank_transfers.sql`.

## Set up (Admin, Settings, Bank transfer top-ups)

1. Enter the bank name, account name and a 10-digit account number.
2. Set the minimum and maximum top-up (admins only), how long an unpaid request stays open (default 24 hours) and how many
   open requests one reader may have (default 3). Defaults: ₦500 minimum, ₦50,000 maximum.
3. Tick the switch. It stays off until the bank details are complete.

## Normal transfer or P2P (no request needed)

The reader sends money to your account with their username in the narration. When you see the credit alert, go to
**Admin, Bank transfers, Credit a reader from a bank alert**: enter the username, the amount that arrived and the bank's
own reference or session ID for that credit, then **Credit wallet**. The bank reference can only be used once, so the same
alert can never credit twice. (needs `supabase/migrations/0014_bank_direct_credit.sql`)

## Optional: request with a unique reference

Top up, then **Pay by bank transfer**: enter an amount, get your bank details and a unique reference such as `VLR-7K3Q9`,
pay from the bank app with the reference in the narration, then tap **I've paid** (optionally typing the sender name).
Nothing is credited at this point.

## Your flow (Admin, Bank transfers)

- Requests the reader marked as paid are listed first (and counted in the nav badge).
- Open your bank account, find the credit with the same amount and reference, then **Approve and credit wallet**. You can
  change the amount if they sent more or less. Or **Reject** with a reason.
- Never approve from a screenshot or a message. Only approve money that is in your account.
- Unpaid requests expire on their own. You can still approve one that expires if the money arrives late.
- Approval credits the wallet exactly once and writes an audit log entry. It shows up as a normal top-up in Admin,
  Payments (provider `manual`) and in the overview top-up totals. A top-up is not unlock revenue until the reader spends it.

## Things to know

- Your bank statement shows the sender's real name, which weakens the platform's anonymity. Keep it private and say so in
  your privacy policy.
- Confirm with your bank that it allows receiving this kind of income, and get local advice on licensing, tax and
  anti-money-laundering duties before launch.
- Only admins can approve. Moderators cannot.
