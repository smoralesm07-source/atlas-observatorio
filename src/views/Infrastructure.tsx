import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/infrastructure.css';

type InfraData = Record<string, any>;

const SEEDED: InfraData = {
  ok: true,
  generated_at: '2026-09-08T12:52:09Z',
  summary: {
    estimated_known_baseline_usd_month: 35,
    cost_scope: 'Supabase estimado; GitHub y Cloudflare sin billing conectado.',
    main_db_reference_pct: 93.8,
    repos_total: 20,
    active_supabase_projects: 2,
    edge_functions: 33,
    cloudflare_workers_known: 1,
    security_advisories: 2,
    connection_pressure_pct: 15,
  },
  github: {
    status: 'healthy', mode: 'snapshot', plan: null,
    repos: { total: 20, public: 18, private: 2, bytes: 155155456, largest: [
      { name: 'Radar-CGR', bytes: 35782656, private: false },
      { name: 'Radar_prensa', bytes: 28554240, private: false },
      { name: 'Radar_OSFL', bytes: 25720832, private: false },
      { name: 'AML-Workbench-Portal', bytes: 16432128, private: false },
    ] },
    pricing_reference: { free_usd_month: 0, free_actions_minutes_month: 2000, public_repo_actions_minutes_free: true },
    actual_spend_usd: null,
  },
  supabase: {
    status: 'healthy', plan: 'pro', estimated_baseline_usd_month: 35,
    estimate_assumption: 'Plan Pro + 2 proyectos Micro - US$10 de crédito mensual. Estimación, no factura.',
    projects: [
      { id: 'ldmtlwzqaqmegedktlxr', name: 'ATLAS / Observatorio', status: 'ACTIVE_HEALTHY', live: true, database_bytes: 7501827219, disk_reference_pct: 93.8, disk_reference_bytes: 8000000000, connections_total: 9, connections_active: 1, max_connections: 60, public_tables: 123, public_tables_bytes: 7387758592, auth_users: 2, storage_objects: 37, storage_bytes: 16809546, cache_hit_pct: 90.79, unused_indexes: 359, tables_without_primary_key: 5, deadlocks: 0, largest_tables: [
        { table: 'aml_sii_registry_company', bytes: 1621073920 },
        { table: 'aml_res_company', bytes: 1476517888 },
        { table: 'aml_res_actuation', bytes: 1211932672 },
        { table: 'aml_res_address_history', bytes: 1063067648 },
        { table: 'aml_res_entity_bridge', bytes: 405577728 },
        { table: 'obs_finding', bytes: 152363008 },
      ] },
      { id: 'bzqxvidggykkdouotylg', name: 'AML CLAUDE', status: 'ACTIVE_HEALTHY', live: false, observed_at: '2026-09-08T12:47:00Z', database_bytes: 858623123, disk_reference_pct: 10.7, disk_reference_bytes: 8000000000, connections_total: 10, connections_active: 1, max_connections: 60, public_tables: 27, storage_objects: 0, storage_bytes: 0 },
    ],
    edge_functions: { total: 33, verify_jwt_true: 12, verify_jwt_false: 21, observed_at: '2026-09-08T12:47:00Z' },
    actual_invoice_usd: null,
  },
  cloudflare: {
    status: 'unknown', mode: 'snapshot', workers_known: 1, worker: 'atlas-maigret-osint',
    endpoint: 'https://atlas-maigret-osint.atlas-aml-7fb3d5ff.workers.dev', latency_ms: null,
    pricing_reference: { free_plan_available: true, paid_minimum_usd_month: 5, paid_requests_included_month: 10000000, paid_cpu_ms_included_month: 30000000 },
    actual_spend_usd: null, actual_requests: null,
  },
  security: {
    security_advisories: 2,
    leaked_password_protection: 'disabled',
    signed_in_security_definer_rpc: 'obs_uaf_screening_block',
    edge_functions_without_platform_jwt: 21,
  },
  history: [],
};

function bytes(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  return `${(n / 1000 ** i).toFixed(i > 2 ? 2 : i > 1 ? 1 : 0)} ${u[i]}`;
}
function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `US$${n.toFixed(n % 1 ? 2 : 0)}` : 'No conectado';
}
function pct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}
function age(iso?: string) {
  if (!iso) return 'sin corte';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 90_000) return 'ahora';
  if (ms < 3_600_000) return `hace ${Math.round(ms / 60_000)} min`;
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
function statusLabel(status?: string) {
  if (status === 'healthy') return 'Operativo';
  if (status === 'degraded') return 'Degradado';
  if (status === 'watch') return 'Vigilar';
  return 'Sin telemetría';
}
function statusTone(status?: string) {
  if (status === 'healthy') return 'good';
  if (status === 'degraded') return 'bad';
  if (status === 'watch') return 'warn';
  return 'muted';
}

export function Infrastructure() {
  const [data, setData] = useState<InfraData>(SEEDED);
  const [mode, setMode] = useState<'snapshot' | 'live'>('snapshot');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data: next, error: invokeError } = await supabase.functions.invoke('atlas-infra-metrics', { body: {} });
      if (invokeError) throw invokeError;
      if (!next?.ok) throw new Error(next?.error || 'El colector no devolvió un snapshot válido.');
      setData(next);
      setMode('live');
      setError(null);
    } catch (e) {
      setMode('snapshot');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const main = data.supabase?.projects?.[0] ?? {};
  const secondary = data.supabase?.projects?.[1] ?? {};
  const dbHistory = useMemo(
    () => (data.history ?? [])
      .filter((x: any) => x.provider === 'supabase' && x.metric_key === 'database_bytes')
      .map((x: any) => ({ t: x.captured_at, v: Number(x.value_numeric) })),
    [data.history],
  );

  const alerts = [
    main.disk_reference_pct >= 90 ? { tone: 'warn', title: 'Base principal sobre 90% de la referencia incluida', text: `${pct(main.disk_reference_pct)} de 8 GB. Conviene vigilar crecimiento antes de que derive en costo o necesidad de ampliar disco.` } : null,
    data.security?.security_advisories ? { tone: 'bad', title: `${data.security.security_advisories} advertencias de seguridad`, text: 'Incluyen protección de contraseñas filtradas desactivada y un RPC SECURITY DEFINER ejecutable por usuarios autenticados.' } : null,
    main.unused_indexes ? { tone: 'muted', title: `${main.unused_indexes} índices sin lecturas observadas`, text: 'No implica borrarlos automáticamente: es una cola de revisión para reducir escritura, espacio y mantenimiento innecesario.' } : null,
  ].filter(Boolean) as { tone: string; title: string; text: string }[];

  return (
    <div className="fade-in infra-view">
      <header className="infra-command">
        <div>
          <div className="infra-kicker">Control plane · GitHub · Supabase · Cloudflare</div>
          <h1>Infraestructura en una sola mirada</h1>
          <p className="view-lede">
            Capacidad, gasto conocido, disponibilidad y deuda técnica del stack que sostiene ATLAS.
            La vista se actualiza cada minuto y distingue explícitamente telemetría real, estimaciones y datos aún no conectados.
          </p>
        </div>
        <div className="infra-command-actions">
          <span className={`infra-live ${mode}`}><i />{mode === 'live' ? 'telemetría viva' : 'snapshot de respaldo'}</span>
          <span className="infra-updated">Corte {age(data.generated_at)}</span>
          <button className="infra-refresh" onClick={reload} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar ahora'}</button>
        </div>
      </header>

      {error && (
        <div className="infra-banner warn">
          <b>El colector no respondió.</b> Se mantiene el último snapshot validado para no dejar el tablero ciego. {error}
        </div>
      )}

      <section className="infra-kpis" aria-label="Indicadores principales de infraestructura">
        <Metric label="Base mensual conocida" value={`${money(data.summary?.estimated_known_baseline_usd_month)}/mes`} hint="Supabase estimado · no incluye gasto desconocido" tone="accent" />
        <Metric label="Presión base principal" value={pct(data.summary?.main_db_reference_pct)} hint={`${bytes(main.database_bytes)} sobre referencia Pro de 8 GB`} tone={main.disk_reference_pct >= 90 ? 'warn' : 'good'} progress={main.disk_reference_pct} />
        <Metric label="Activos de código" value={`${data.summary?.repos_total ?? '—'} repos`} hint={`${data.github?.repos?.public ?? '—'} públicos · ${data.github?.repos?.private ?? '—'} privados`} />
        <Metric label="Cómputo desplegado" value={`${data.summary?.edge_functions ?? '—'} Edge Functions`} hint={`${data.summary?.cloudflare_workers_known ?? '—'} Worker Cloudflare conocido`} />
        <Metric label="Riesgo técnico" value={`${data.summary?.security_advisories ?? '—'} alertas`} hint={`${main.tables_without_primary_key ?? '—'} tablas sin PK · ${main.deadlocks ?? '—'} deadlocks`} tone={data.summary?.security_advisories ? 'bad' : 'good'} />
      </section>

      <section className="infra-provider-grid">
        <Provider title="GitHub" status={data.github?.status} subtitle="Código · Actions · Pages">
          <div className="infra-provider-hero">
            <strong>{data.github?.repos?.total ?? '—'}</strong><span>repositorios administrados</span>
          </div>
          <Facts rows={[
            ['Huella repositorios', bytes(data.github?.repos?.bytes)],
            ['Plan detectado', data.github?.plan || 'No expuesto por API actual'],
            ['Gasto real', money(data.github?.actual_spend_usd)],
            ['Actions', data.github?.pricing_reference?.public_repo_actions_minutes_free ? 'Públicos sin costo de minutos' : 'Según plan'],
            ['Referencia Free', `${data.github?.pricing_reference?.free_actions_minutes_month?.toLocaleString('es-CL') ?? '2.000'} min/mes privados`],
          ]} />
          <MiniList title="Repositorios de mayor huella" items={(data.github?.repos?.largest ?? []).slice(0, 4).map((r: any) => ({ label: r.name, value: bytes(r.bytes), tag: r.private ? 'privado' : 'público' }))} />
        </Provider>

        <Provider title="Supabase" status={data.supabase?.status} subtitle={`Plan ${String(data.supabase?.plan || '—').toUpperCase()} · Postgres · Auth · Edge`}>
          <div className="infra-provider-hero">
            <strong>{money(data.supabase?.estimated_baseline_usd_month)}</strong><span>base mensual estimada</span>
          </div>
          <ProjectRow project={main} primary />
          <ProjectRow project={secondary} />
          <Facts rows={[
            ['Conexiones principal', `${main.connections_total ?? '—'} / ${main.max_connections ?? '—'}`],
            ['Cache hit', pct(main.cache_hit_pct)],
            ['Storage objetos', `${main.storage_objects ?? '—'} · ${bytes(main.storage_bytes)}`],
            ['Edge Functions', `${data.supabase?.edge_functions?.total ?? '—'} activas`],
            ['Factura real', money(data.supabase?.actual_invoice_usd)],
          ]} />
          <p className="infra-note">{data.supabase?.estimate_assumption}</p>
        </Provider>

        <Provider title="Cloudflare" status={data.cloudflare?.status} subtitle="Worker · borde · disponibilidad">
          <div className="infra-provider-hero">
            <strong>{data.cloudflare?.latency_ms != null ? `${data.cloudflare.latency_ms} ms` : '—'}</strong><span>latencia del Worker observado</span>
          </div>
          <Facts rows={[
            ['Worker conocido', data.cloudflare?.worker || '—'],
            ['HTTP salud', data.cloudflare?.health_http_status || 'Sin lectura viva'],
            ['Plan real', data.cloudflare?.actual_plan || 'API billing no conectada'],
            ['Gasto real', money(data.cloudflare?.actual_spend_usd)],
            ['Workers Paid', `desde US$${data.cloudflare?.pricing_reference?.paid_minimum_usd_month ?? 5}/mes`],
            ['Incluye', `${((data.cloudflare?.pricing_reference?.paid_requests_included_month ?? 10000000) / 1e6).toFixed(0)} M req/mes`],
          ]} />
          {data.cloudflare?.endpoint && <a className="infra-endpoint" href={data.cloudflare.endpoint} target="_blank" rel="noreferrer">Abrir endpoint observado ↗</a>}
          <p className="infra-note">La disponibilidad puede medirse sin credenciales; consumo y factura requieren una conexión de cuenta Cloudflare en el colector.</p>
        </Provider>
      </section>

      <section className="infra-two-col">
        <div className="infra-panel">
          <PanelHead eyebrow="Capacidad" title="Qué está empujando la base principal" meta={`${bytes(main.database_bytes)} totales`} />
          <div className="infra-capacity-main">
            <Progress value={main.disk_reference_pct} tone={main.disk_reference_pct >= 90 ? 'warn' : 'good'} />
            <div><b>{pct(main.disk_reference_pct)}</b><span>de la referencia de 8 GB incluida por proyecto en Pro</span></div>
          </div>
          <div className="infra-table-bars">
            {(main.largest_tables ?? []).map((row: any) => {
              const max = Number(main.largest_tables?.[0]?.bytes || 1);
              return <BarRow key={row.table} label={row.table} value={row.bytes} max={max} />;
            })}
          </div>
        </div>

        <div className="infra-panel">
          <PanelHead eyebrow="Rendimiento" title="Señales operativas Postgres" meta="principal · vivo" />
          <div className="infra-health-grid">
            <HealthStat label="Cache hit" value={pct(main.cache_hit_pct)} hint="lecturas servidas desde cache" tone={Number(main.cache_hit_pct) >= 95 ? 'good' : 'warn'} />
            <HealthStat label="Conexiones" value={`${main.connections_total ?? '—'}/${main.max_connections ?? '—'}`} hint={`${pct(data.summary?.connection_pressure_pct)} de presión`} tone="good" />
            <HealthStat label="Deadlocks" value={String(main.deadlocks ?? '—')} hint="acumulados desde reset de estadísticas" tone={Number(main.deadlocks || 0) === 0 ? 'good' : 'bad'} />
            <HealthStat label="Índices sin uso" value={String(main.unused_indexes ?? '—')} hint="sin scans observados" tone="muted" />
            <HealthStat label="Tablas sin PK" value={String(main.tables_without_primary_key ?? '—')} hint="revisar antes de escalar" tone={Number(main.tables_without_primary_key || 0) ? 'warn' : 'good'} />
            <HealthStat label="Tablas públicas" value={String(main.public_tables ?? '—')} hint={bytes(main.public_tables_bytes)} tone="muted" />
          </div>
          <Trend data={dbHistory} current={main.database_bytes} />
        </div>
      </section>

      <section className="infra-two-col">
        <div className="infra-panel">
          <PanelHead eyebrow="Atención" title="Alertas que sí cambian decisiones" meta={`${alerts.length} activas`} />
          <div className="infra-alert-list">
            {alerts.map((a) => <div key={a.title} className={`infra-alert ${a.tone}`}><i /><div><b>{a.title}</b><p>{a.text}</p></div></div>)}
          </div>
        </div>

        <div className="infra-panel">
          <PanelHead eyebrow="Cobertura" title="Qué medimos realmente" meta="sin falsos ceros" />
          <Coverage rows={[
            ['Supabase · base y conexiones', 'Tiempo real', 'good'],
            ['Supabase · factura', 'No conectada', 'muted'],
            ['GitHub · repositorios', data.github?.mode === 'authenticated' ? 'API autenticada' : 'Público + inventario privado conocido', 'good'],
            ['GitHub · Actions/billing real', 'No conectado', 'muted'],
            ['Cloudflare · salud Worker', data.cloudflare?.status === 'healthy' ? 'Tiempo real' : 'Sin lectura', data.cloudflare?.status === 'healthy' ? 'good' : 'warn'],
            ['Cloudflare · requests/CPU/factura', 'No conectado', 'muted'],
          ]} />
          <div className="infra-next">
            <b>Diseño preparado para completar billing sin tocar el frontend.</b>
            <span>Los tokens de GitHub Management o Cloudflare deben vivir como secretos del colector, nunca en Vite ni en GitHub Pages.</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, hint, tone = 'neutral', progress }: { label: string; value: string; hint: string; tone?: string; progress?: number }) {
  return <div className={`infra-metric ${tone}`}><span>{label}</span><b>{value}</b><small>{hint}</small>{progress != null && <Progress value={progress} tone={tone} />}</div>;
}
function Progress({ value, tone = 'neutral' }: { value: number; tone?: string }) {
  return <div className={`infra-progress ${tone}`} aria-label={`${value}%`}><i style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></div>;
}
function Provider({ title, subtitle, status, children }: { title: string; subtitle: string; status?: string; children: React.ReactNode }) {
  return <article className="infra-provider"><header><div><span className="infra-provider-title">{title}</span><small>{subtitle}</small></div><span className={`infra-status ${statusTone(status)}`}><i />{statusLabel(status)}</span></header>{children}</article>;
}
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="infra-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
function MiniList({ title, items }: { title: string; items: { label: string; value: string; tag?: string }[] }) {
  return <div className="infra-mini"><span>{title}</span>{items.map((x) => <div key={x.label}><b>{x.label}</b><em>{x.tag}</em><small>{x.value}</small></div>)}</div>;
}
function ProjectRow({ project, primary = false }: { project: any; primary?: boolean }) {
  if (!project?.id) return null;
  return <div className="infra-project"><div><b>{project.name}</b><small>{primary ? 'principal' : project.live ? 'vivo' : `snapshot ${age(project.observed_at)}`}</small></div><span>{bytes(project.database_bytes)}</span><Progress value={Number(project.disk_reference_pct || 0)} tone={Number(project.disk_reference_pct || 0) >= 90 ? 'warn' : 'good'} /></div>;
}
function PanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) {
  return <header className="infra-panel-head"><div><span>{eyebrow}</span><h2>{title}</h2></div>{meta && <small>{meta}</small>}</header>;
}
function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  return <div className="infra-bar-row"><div><span>{label}</span><b>{bytes(value)}</b></div><div className="infra-bar"><i style={{ width: `${Math.max(2, (Number(value || 0) / Math.max(1, max)) * 100)}%` }} /></div></div>;
}
function HealthStat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return <div className={`infra-health ${tone}`}><span>{label}</span><b>{value}</b><small>{hint}</small></div>;
}
function Coverage({ rows }: { rows: [string, string, string][] }) {
  return <div className="infra-coverage">{rows.map(([name, state, tone]) => <div key={name}><span>{name}</span><b className={tone}><i />{state}</b></div>)}</div>;
}
function Trend({ data, current }: { data: { t: string; v: number }[]; current: number }) {
  const values = data.length ? data.map((d) => d.v) : [Number(current || 0), Number(current || 0)];
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${34 - ((v - min) / span) * 28}`).join(' ');
  return <div className="infra-trend"><div><span>Huella DB · 7 días</span><small>{data.length >= 2 ? `${data.length} cortes` : 'historial acumulándose desde hoy'}</small></div><svg viewBox="0 0 100 38" preserveAspectRatio="none" role="img" aria-label="Tendencia de tamaño de base"><polyline points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg></div>;
}
