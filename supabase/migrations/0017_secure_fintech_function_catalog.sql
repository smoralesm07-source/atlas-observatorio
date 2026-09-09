-- Keep the functional catalog behind the same RLS boundary as the rest of the Fintech engine.
alter table public.aml_fintech_function_catalog enable row level security;
revoke all on public.aml_fintech_function_catalog from anon,authenticated;
