create index if not exists obs_public_funds_payer_rut_year_amount_idx
on public.obs_public_funds_payer_year (rut, period_year desc, amount desc)
include (payer_key, payer_name, role, transaction_count, first_seen, last_seen);
