-- Give the federated entity-search RPC a small amount of headroom above the
-- authenticated role's global 8s statement_timeout. This is intentionally
-- scoped to this function only; it does not relax the timeout for the rest of
-- Atlas.
--
-- The cascade normally completes well below this threshold, but occasional
-- cold-cache/concurrent searches can approach the global limit and surface a
-- 57014 timeout to the analyst.

alter function public.atlas_v2_entity_search_cascade(jsonb)
  set statement_timeout = '12s';
