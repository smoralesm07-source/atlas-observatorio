revoke all on sequence public.aml_fintech_profile_audit_audit_id_seq from public,anon,authenticated;
grant usage,select on sequence public.aml_fintech_profile_audit_audit_id_seq to service_role;