import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const GITHUB_USER = "smoralesm07-source";
const CLOUDFLARE_WORKER = "https://atlas-maigret-osint.atlas-aml-7fb3d5ff.workers.dev";
const SECONDARY_SUPABASE = {
  id: "bzqxvidggykkdouotylg",
  name: "AML CLAUDE",
  region: "us-west-2",
  status: "ACTIVE_HEALTHY",
  observed_at: "2026-09-08T12:47:00Z",
  database_bytes: 858623123,
  connections_total: 10,
  connections_active: 1,
  max_connections: 60,
  public_tables: 27,
  public_tables_bytes: 291389440,
  auth_users: 1,
  storage_objects: 0,
  storage_bytes: 0,
};
const KNOWN_PRIVATE_REPOS = [
  { name: "Intelligence_Fusion_Layer", size_kb: 10437 },
  { name: "atlas-aml-methodology", size_kb: 38 },
];
const SEEDED_EDGE_FUNCTIONS = {
  total: 33,
  verify_jwt_true: 12,
  verify_jwt_false: 21,
  observed_at: "2026-09-08T12:47:00Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function num(v: unknown, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
const iso = () => new Date().toISOString();

async function fetchJson(url: string, init: RequestInit = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(8000),
      headers: {
        "user-agent": "ATLAS-Infra-Monitor/1.0",
        accept: "application/vnd.github+json",
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: response.ok, status: response.status, latency_ms: Date.now() - started, data };
  } catch (error) {
    return { ok: false, status: 0, latency_ms: Date.now() - started, data: null, error: String(error) };
  }
}

async function githubSnapshot() {
  const token = (Deno.env.get("INFRA_GITHUB_TOKEN") || "").trim();
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const repoUrl = token
    ? "https://api.github.com/user/repos?per_page=100&affiliation=owner&sort=updated"
    : `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&type=owner&sort=updated`;
  const [reposResponse, userResponse] = await Promise.all([
    fetchJson(repoUrl, { headers }),
    token ? fetchJson("https://api.github.com/user", { headers }) : Promise.resolve(null),
  ]);

  const repos = Array.isArray(reposResponse.data)
    ? reposResponse.data.filter((r: any) => r?.owner?.login === GITHUB_USER)
    : [];
  const authenticated = !!token && reposResponse.ok;
  const publicRepos = repos.filter((r: any) => !r.private);
  const privateRepos = repos.filter((r: any) => !!r.private);
  const knownPrivate = authenticated ? [] : KNOWN_PRIVATE_REPOS;
  const total = authenticated ? repos.length : publicRepos.length + knownPrivate.length;
  const bytes = repos.reduce((a: number, r: any) => a + num(r.size) * 1024, 0)
    + knownPrivate.reduce((a, r) => a + r.size_kb * 1024, 0);
  const largest = [
    ...repos.map((r: any) => ({ name: r.name, bytes: num(r.size) * 1024, private: !!r.private, updated_at: r.updated_at })),
    ...knownPrivate.map((r) => ({ name: r.name, bytes: r.size_kb * 1024, private: true, updated_at: null })),
  ].sort((a, b) => b.bytes - a.bytes).slice(0, 6);

  const plan = token && userResponse?.ok ? userResponse.data?.plan?.name || null : null;
  return {
    status: reposResponse.ok ? "healthy" : "degraded",
    latency_ms: reposResponse.latency_ms,
    mode: authenticated ? "authenticated" : "public_plus_known_private",
    account: GITHUB_USER,
    plan,
    repos: {
      total,
      public: publicRepos.length,
      private: authenticated ? privateRepos.length : knownPrivate.length,
      bytes,
      largest,
    },
    pricing_reference: {
      free_usd_month: 0,
      free_actions_minutes_month: 2000,
      public_repo_actions_minutes_free: true,
      source: "https://github.com/pricing",
    },
    actual_spend_usd: null,
    actual_actions_minutes: null,
  };
}

async function cloudflareSnapshot() {
  const started = Date.now();
  let health: any = { ok: false, status: 0, latency_ms: null, data: null };
  try {
    const response = await fetch(`${CLOUDFLARE_WORKER}/health`, {
      headers: { "user-agent": "ATLAS-Infra-Monitor/1.0", accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 300); }
    health = { ok: response.ok, status: response.status, latency_ms: Date.now() - started, data };
  } catch (error) {
    health = { ok: false, status: 0, latency_ms: Date.now() - started, error: String(error), data: null };
  }
  return {
    status: health.ok ? "healthy" : health.status > 0 && health.status < 500 ? "watch" : "degraded",
    mode: "public_health_only",
    workers_known: 1,
    worker: "atlas-maigret-osint",
    endpoint: CLOUDFLARE_WORKER,
    health_http_status: health.status,
    latency_ms: health.latency_ms,
    pricing_reference: {
      free_plan_available: true,
      paid_minimum_usd_month: 5,
      paid_requests_included_month: 10000000,
      paid_cpu_ms_included_month: 30000000,
      requests_overage_usd_per_million: 0.30,
      cpu_overage_usd_per_million_ms: 0.02,
      source: "https://developers.cloudflare.com/workers/platform/pricing/",
    },
    actual_plan: null,
    actual_spend_usd: null,
    actual_requests: null,
    note: "La cuenta Cloudflare no está conectada al colector; se verifica disponibilidad pública del Worker sin exponer secretos.",
  };
}

function supabaseSnapshot(local: any) {
  const includedDisk = 8_000_000_000;
  const main = {
    id: "ldmtlwzqaqmegedktlxr",
    name: "ATLAS / Observatorio",
    region: "us-west-2",
    status: "ACTIVE_HEALTHY",
    live: true,
    ...local,
    disk_reference_bytes: includedDisk,
    disk_reference_pct: Number(((num(local?.database_bytes) / includedDisk) * 100).toFixed(1)),
  };
  const secondary = {
    ...SECONDARY_SUPABASE,
    live: false,
    disk_reference_bytes: includedDisk,
    disk_reference_pct: Number(((SECONDARY_SUPABASE.database_bytes / includedDisk) * 100).toFixed(1)),
  };
  return {
    status: "healthy",
    plan: "pro",
    projects: [main, secondary],
    pricing_reference: {
      pro_usd_month: 25,
      included_disk_bytes_per_project: includedDisk,
      extra_disk_usd_gb: 0.125,
      micro_compute_usd_month: 10,
      compute_credit_usd_month: 10,
      source: "https://supabase.com/pricing",
    },
    estimated_baseline_usd_month: 35,
    estimate_assumption: "Plan Pro + 2 proyectos Micro - US$10 de crédito mensual. Es una estimación, no una factura.",
    edge_functions: SEEDED_EDGE_FUNCTIONS,
    actual_invoice_usd: null,
  };
}

async function recordHistory(admin: any, snapshot: any) {
  try {
    const { data: last } = await admin
      .from("obs_infra_snapshot_history")
      .select("captured_at")
      .eq("provider", "supabase")
      .eq("metric_key", "database_bytes")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastMs = last?.captured_at ? new Date(last.captured_at).getTime() : 0;
    if (Date.now() - lastMs < 5 * 60_000) return;
    await admin.from("obs_infra_snapshot_history").insert([
      { provider: "supabase", metric_key: "database_bytes", value_numeric: snapshot.supabase.projects[0].database_bytes, metadata: { project: snapshot.supabase.projects[0].id } },
      { provider: "supabase", metric_key: "connections_total", value_numeric: snapshot.supabase.projects[0].connections_total, metadata: { project: snapshot.supabase.projects[0].id } },
      { provider: "github", metric_key: "repository_bytes", value_numeric: snapshot.github.repos.bytes, metadata: { repos: snapshot.github.repos.total } },
      { provider: "cloudflare", metric_key: "health_latency_ms", value_numeric: snapshot.cloudflare.latency_ms, value_text: snapshot.cloudflare.status, metadata: { worker: snapshot.cloudflare.worker } },
    ]);
  } catch (_) {
    // History must never make the live snapshot fail.
  }
}

async function loadHistory(admin: any) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const { data } = await admin
    .from("obs_infra_snapshot_history")
    .select("captured_at,provider,metric_key,value_numeric,value_text")
    .gte("captured_at", since)
    .order("captured_at", { ascending: true })
    .limit(500);
  return data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = req.headers.get("authorization") || "";
  if (!authorization) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const caller = createClient(url, anon, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return json({ ok: false, error: "INVALID_SESSION" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed } = await admin
    .from("aml_allowed_users")
    .select("user_id,enabled")
    .eq("user_id", userData.user.id)
    .eq("enabled", true)
    .maybeSingle();
  if (!allowed) return json({ ok: false, error: "NOT_AUTHORIZED" }, 403);

  const { data: local, error: metricError } = await admin.rpc("obs_infra_local_metrics");
  if (metricError) return json({ ok: false, error: "METRICS_UNAVAILABLE", detail: metricError.message }, 500);

  const [github, cloudflare] = await Promise.all([githubSnapshot(), cloudflareSnapshot()]);
  const supabase = supabaseSnapshot(local || {});
  const security = {
    security_advisories: 2,
    security_advisories_observed_at: "2026-09-08T12:47:13Z",
    leaked_password_protection: "disabled",
    signed_in_security_definer_rpc: "obs_uaf_screening_block",
    edge_functions_without_platform_jwt: SEEDED_EDGE_FUNCTIONS.verify_jwt_false,
    edge_function_note: "Las funciones sin JWT de plataforma pueden usar autenticación propia; requieren revisión, no se clasifican automáticamente como vulnerables.",
  };

  const snapshot: any = {
    ok: true,
    generated_at: iso(),
    github,
    supabase,
    cloudflare,
    deployment: { github_pages: true, github_actions: true, supabase_edge_functions: true, cloudflare_workers: true },
    security,
    summary: {
      estimated_known_baseline_usd_month: supabase.estimated_baseline_usd_month,
      cost_scope: "Supabase estimado; GitHub y Cloudflare muestran precio de referencia hasta conectar sus APIs de billing.",
      main_db_reference_pct: supabase.projects[0].disk_reference_pct,
      repos_total: github.repos.total,
      active_supabase_projects: 2,
      edge_functions: SEEDED_EDGE_FUNCTIONS.total,
      cloudflare_workers_known: 1,
      security_advisories: security.security_advisories,
      connection_pressure_pct: Number(((num(local?.connections_total) / Math.max(1, num(local?.max_connections, 60))) * 100).toFixed(1)),
    },
  };

  await recordHistory(admin, snapshot);
  snapshot.history = await loadHistory(admin);
  return json(snapshot);
});
