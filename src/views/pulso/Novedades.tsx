import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../components/primitives';
import { hrefFor } from '../../lib/router';
import { supabase } from '../../lib/supabase';
import './Novedades.css';
import './CriticalAlerts.css';

type UpdateKind = 'ALERTA_CRITICA' | 'CORTE' | 'PRENSA' | 'FUENTE' | 'SANCION' | 'ESTADO' | 'POTENCIAL' | 'BAJA_SO';
type PriorityGroup = 1 | 2 | 3 | 4;
type AlertSeverity = 'CRITICAL' | 'HIGH';

interface UpdateItem {
  id: string;
  kind: UpdateKind;
  event_at: string;
  title: string;
  detail: string | null;
  source_label: string | null;
  source_url: string | null;
  entity_id: string | null;
  entity_name: string | null;
  meta: string | null;
  priority_group?: PriorityGroup;
  priority_label?: string | null;
  action_hash?: string | null;
  action_label?: string | null;
  severity?: AlertSeverity | null;
  urgency_score?: number | null;
  identity_confidence?: number | null;
  mention_confidence?: number | null;
  signal_label?: string | null;
  article_count?: number | null;
  source_count?: number | null;
  ipa3_score?: number | null;
  ipa3_band?: string | null;
  ipa_gap?: 'SIN_IPA_VIGENTE' | 'IPA_BAJO' | null;
  match_basis?: string | null;
  alert_reason?: string | null;
  latest_title?: string | null;
}

interface UpdatesFeed {
  contract: 'ATLAS_OBS_UAF_UPDATES_V1' | 'ATLAS_OBS_UAF_UPDATES_V2' | 'ATLAS_OBS_UAF_UPDATES_V3';
  generated_at: string;
  items: UpdateItem[];
  semantics: string;
  critical_count?: number;
  high_count?: number;
}

interface CriticalFeed {
  contract: 'ATLAS_OBS_CRITICAL_ALERTS_V1';
  generated_at: string;
  critical_count: number;
  high_count: number;
  items: UpdateItem[];
  semantics: string;
}

const LABEL: Record<UpdateKind, string> = {
  ALERTA_CRITICA: 'ALERTA CRÍTICA',
  CORTE: 'CORTE',
  PRENSA: 'PRENSA',
  FUENTE: 'FUENTES',
  SANCION: 'SANCIÓN',
  ESTADO: 'ESTADO SO',
  POTENCIAL: 'POTENCIAL',
  BAJA_SO: 'TÉRMINO GIRO',
};

const PRIORITY_LABEL: Record<PriorityGroup, string> = {
  1: 'Padrón SO',
  2: 'Potenciales SO',
  3: 'Bajas SO',
  4: 'Fuentes y radares',
};

const SEMANTICS = 'Novedades operativas priorizadas: primero hechos sobre sujetos obligados inscritos; luego potenciales SO, empresas nuevas o nuevos giros relacionados; después términos de giro del último lote para revisión de cancelación; finalmente salud e incidencias de radares y fuentes. Las alertas críticas combinan identidad de alta confianza, prensa asociada a LA/FT o delitos base y una brecha del IPA; ordenan revisión y no acreditan responsabilidad.';

export function NovedadesObservatorio({ compact = false }: { compact?: boolean }) {
  const [feed, setFeed] = useState<UpdatesFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    let baseFeed: UpdatesFeed | null = null;
    let criticalFeed: CriticalFeed | null = null;
    const warnings: string[] = [];

    try {
      const [baseResult, criticalResult] = await Promise.allSettled([
        loadRpcFeed(),
        loadCriticalFeed(),
      ]);

      if (baseResult.status === 'fulfilled') {
        baseFeed = baseResult.value;
      } else {
        try {
          baseFeed = await loadDirectFeed();
          warnings.push('feed operativo en modo alternativo');
        } catch (fallbackError) {
          const firstMessage = messageOf(baseResult.reason);
          const fallbackMessage = messageOf(fallbackError);
          throw new Error(`${firstMessage} · ${fallbackMessage}`);
        }
      }

      if (criticalResult.status === 'fulfilled') {
        criticalFeed = criticalResult.value;
      } else {
        warnings.push(`alertas críticas: ${messageOf(criticalResult.reason)}`);
      }

      setFeed(mergeFeeds(baseFeed, criticalFeed));
      setError(warnings.length ? warnings.join(' · ') : null);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const allItems = (feed?.items ?? []).map(withPriorityDefaults);
  const items = compact ? selectCompactPriorities(allItems) : allItems.slice(0, 10);
  const criticalCount = feed?.critical_count ?? allItems.filter((item) => item.kind === 'ALERTA_CRITICA' && item.severity === 'CRITICAL').length;
  const highCount = feed?.high_count ?? allItems.filter((item) => item.kind === 'ALERTA_CRITICA' && item.severity === 'HIGH').length;

  return (
    <div className={compact ? 'pulse-updates-compact' : undefined}>
      <Panel
        title="Novedades prioritarias"
        pad={false}
        actions={
          <div className="pulse-updates-actions">
            {criticalCount > 0 && (
              <span className="pulse-critical-counter" title="Alertas críticas que requieren revisión analítica">
                <i /> {criticalCount} crítica{criticalCount === 1 ? '' : 's'}
              </span>
            )}
            {criticalCount === 0 && highCount > 0 && (
              <span className="pulse-high-counter">{highCount} alta{highCount === 1 ? '' : 's'}</span>
            )}
            <span className="pulse-updates-live" title="El panel se consulta silenciosamente cada 5 minutos sin alterar la navegación">
              <i /> dinámico
            </span>
            <button
              type="button"
              className="pulse-updates-refresh"
              onClick={() => void load(true)}
              disabled={refreshing}
              aria-label="Actualizar novedades"
              title="Actualizar ahora"
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>
        }
      >
        <div className="pulse-updates-shell">
          {loading && !feed ? (
            <div className="pulse-updates-state">Leyendo prioridades operativas…</div>
          ) : error && !feed ? (
            <div className="pulse-updates-state pulse-updates-error">
              <b>No fue posible cargar las novedades.</b>
              <button type="button" onClick={() => void load(false)}>Reintentar</button>
            </div>
          ) : items.length === 0 ? (
            <div className="pulse-updates-state">Sin novedades observadas en las fuentes activas.</div>
          ) : (
            <div className="pulse-updates-list" aria-live="polite">
              {items.map((item) => (
                item.kind === 'ALERTA_CRITICA'
                  ? <CriticalAlert key={item.id} item={item} compact={compact} />
                  : <StandardUpdate key={item.id} item={item} compact={compact} />
              ))}
            </div>
          )}

          <div className="pulse-updates-caption">
            <span>{feed?.generated_at ? `Actualizado ${formatGenerated(feed.generated_at)}` : 'Prioridad operativa Atlas'}</span>
            {error && feed && <em title={error}>sincronización parcial</em>}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function CriticalAlert({ item, compact }: { item: UpdateItem; compact: boolean }) {
  const critical = item.severity === 'CRITICAL';
  const confidence = Math.round(Number(item.identity_confidence ?? 0));
  const articles = Number(item.article_count ?? 0);
  const sources = Number(item.source_count ?? 0);
  const urgency = Math.round(Number(item.urgency_score ?? (critical ? 100 : 75)));
  const noIpa = item.ipa_gap === 'SIN_IPA_VIGENTE';
  const entityHref = item.entity_id ? hrefFor({ view: 'ficha', entityId: item.entity_id }) : null;

  return (
    <article className="pulse-critical-alert" data-severity={item.severity ?? 'HIGH'}>
      <div className="pulse-critical-beacon" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M12 2.8 22 20.5H2L12 2.8Z" />
          <path d="M12 8v6.2M12 17.3v.2" />
        </svg>
      </div>
      <div className="pulse-critical-content">
        <div className="pulse-critical-topline">
          <span className="pulse-critical-label"><i />{critical ? 'ATENCIÓN CRÍTICA' : 'ATENCIÓN ALTA'}</span>
          <time dateTime={item.event_at}>{formatEvent(item.event_at)}</time>
        </div>

        <div className="pulse-critical-heading">
          <h4>{item.entity_name ?? item.title}</h4>
          <span className="pulse-critical-score" title="Prioridad compuesta por identidad, tipo de señal, brecha IPA, fuentes y recencia">
            {urgency}<small>/100</small>
          </span>
        </div>

        <div className="pulse-critical-badges">
          <span data-kind="so">SO inscrito</span>
          <span data-kind={noIpa ? 'gap' : 'ipa'}>{noIpa ? 'Sin IPA vigente' : 'IPA bajo'}</span>
          {item.signal_label && <span data-kind="signal">{item.signal_label}</span>}
        </div>

        <p className="pulse-critical-reason">
          {item.alert_reason ?? item.detail ?? 'Nueva señal externa que requiere revisión analítica.'}
        </p>

        <div className="pulse-critical-metrics" aria-label="Fundamentos de la alerta">
          {confidence > 0 && <span><b>{confidence}%</b> coincidencia</span>}
          {articles > 0 && <span><b>{articles}</b> {articles === 1 ? 'artículo' : 'artículos'}</span>}
          {sources > 0 && <span><b>{sources}</b> {sources === 1 ? 'fuente' : 'fuentes'}</span>}
          {!compact && item.match_basis && <span><b>Identidad</b> {formatMatchBasis(item.match_basis)}</span>}
        </div>

        <div className="pulse-critical-foot">
          <span className="pulse-critical-source" title={item.latest_title ?? item.source_label ?? undefined}>
            {item.source_label ?? 'Radar de prensa'}
            {!compact && item.latest_title ? ` · ${item.latest_title}` : ''}
          </span>
          <span className="pulse-critical-actions">
            {entityHref && <a className="pulse-critical-primary" href={entityHref}>Revisar entidad →</a>}
            {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>}
          </span>
        </div>

        <div className="pulse-critical-disclaimer">Señal de priorización; requiere validación analítica y no acredita responsabilidad.</div>
      </div>
    </article>
  );
}

function StandardUpdate({ item, compact }: { item: UpdateItem; compact: boolean }) {
  const priority = priorityFor(item);
  return (
    <article className="pulse-update" data-kind={item.kind} data-priority={priority}>
      <div className="pulse-update-rail"><i /></div>
      <div className="pulse-update-body">
        <div className="pulse-update-topline">
          <span className="pulse-update-priority">P{priority} · {item.priority_label ?? PRIORITY_LABEL[priority]}</span>
          <span className="pulse-update-kind">{LABEL[item.kind]}</span>
          <time dateTime={item.event_at}>{formatEvent(item.event_at)}</time>
        </div>
        <h4>{displayTitle(item)}</h4>
        {!compact && item.detail && <p>{item.detail}</p>}
        <div className="pulse-update-foot">
          <span>{item.source_label ?? item.meta ?? 'Atlas'}</span>
          <span className="pulse-update-links">
            {item.action_hash && <a href={item.action_hash}>{item.action_label ?? 'Abrir'} →</a>}
            {item.entity_id && (!item.action_hash || !compact) && <a href={hrefFor({ view: 'ficha', entityId: item.entity_id })}>Ficha →</a>}
            {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>}
          </span>
        </div>
      </div>
    </article>
  );
}

function mergeFeeds(base: UpdatesFeed, alerts: CriticalFeed | null): UpdatesFeed {
  if (!alerts) return base;

  const alertEntityIds = new Set(alerts.items.map((item) => item.entity_id).filter(Boolean));
  const baseItems = base.items.filter((item) => !(item.kind === 'PRENSA' && item.entity_id && alertEntityIds.has(item.entity_id)));
  const alertsSorted = alerts.items.slice().sort(compareAlertItems);

  return {
    ...base,
    contract: 'ATLAS_OBS_UAF_UPDATES_V3',
    generated_at: newerTimestamp(base.generated_at, alerts.generated_at),
    items: [...alertsSorted, ...baseItems],
    semantics: `${alerts.semantics} ${base.semantics}`,
    critical_count: alerts.critical_count,
    high_count: alerts.high_count,
  };
}

function compareAlertItems(a: UpdateItem, b: UpdateItem) {
  const severityA = a.severity === 'CRITICAL' ? 0 : 1;
  const severityB = b.severity === 'CRITICAL' ? 0 : 1;
  return severityA - severityB
    || Number(b.urgency_score ?? 0) - Number(a.urgency_score ?? 0)
    || sortableDate(b.event_at) - sortableDate(a.event_at);
}

function newerTimestamp(a: string, b: string) {
  return sortableDate(b) > sortableDate(a) ? b : a;
}

function withPriorityDefaults(item: UpdateItem): UpdateItem {
  const priority = priorityFor(item);
  return {
    ...item,
    priority_group: priority,
    priority_label: item.priority_label ?? PRIORITY_LABEL[priority],
  };
}

function priorityFor(item: UpdateItem): PriorityGroup {
  if (item.kind === 'ALERTA_CRITICA') return 1;
  if (item.priority_group && item.priority_group >= 1 && item.priority_group <= 4) return item.priority_group;
  if (item.kind === 'POTENCIAL') return 2;
  if (item.kind === 'BAJA_SO') return 3;
  if (item.kind === 'FUENTE' || item.kind === 'CORTE') return 4;
  return 1;
}

function selectCompactPriorities(items: UpdateItem[]) {
  const picked: UpdateItem[] = [];
  const critical = items.filter((item) => item.kind === 'ALERTA_CRITICA' && item.severity === 'CRITICAL').slice(0, 2);
  const high = items.find((item) => item.kind === 'ALERTA_CRITICA' && item.severity === 'HIGH');

  picked.push(...critical);
  if (critical.length === 0 && high) picked.push(high);

  for (const priority of [1, 2, 3, 4] as PriorityGroup[]) {
    const match = items.find((item) => priorityFor(item) === priority && !picked.some((current) => current.id === item.id));
    if (match) picked.push(match);
    if (picked.length >= 5) break;
  }

  if (picked.length < 4) {
    for (const item of items) {
      if (picked.some((current) => current.id === item.id)) continue;
      picked.push(item);
      if (picked.length === 4) break;
    }
  }

  return picked.slice(0, 5);
}

function displayTitle(item: UpdateItem) {
  if (item.kind === 'PRENSA' && /^document:press:/i.test(item.title)) {
    return `${item.entity_name ?? 'Sujeto obligado'} · nueva mención en prensa`;
  }
  return item.title;
}

async function loadRpcFeed(): Promise<UpdatesFeed> {
  const { data, error } = await supabase.rpc('obs_uaf_updates');
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('El feed de novedades no devolvió un contrato válido.');
  return data as UpdatesFeed;
}

async function loadCriticalFeed(): Promise<CriticalFeed> {
  const { data, error } = await supabase.rpc('obs_uaf_external_alerts');
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('El motor de alertas críticas no devolvió un contrato válido.');
  return data as CriticalFeed;
}

async function loadDirectFeed(): Promise<UpdatesFeed> {
  const [sourceResult, sanctionResult, pressResult, potentialResult, termResult] = await Promise.all([
    supabase.from('obs_source_health').select('source_code,source_name,software_status,data_status,records_24h,refreshed_at'),
    supabase.from('obs_uaf_evidence').select('evidence_id,rut,event_date,refreshed_at,headline,summary,source_label,document_url,has_link').eq('kind', 'SANCION').order('event_date', { ascending: false, nullsFirst: false }).limit(8),
    supabase.from('obs_uaf_evidence').select('evidence_id,rut,event_date,refreshed_at,headline,summary,source_label,document_url,has_link').eq('kind', 'PRENSA').order('refreshed_at', { ascending: false }).limit(8),
    supabase.from('obs_uaf_potential_candidate').select('rut,entity_id,name,implied_sector,matched_activity,sii_activity_start_date,ivo_score,refreshed_at').order('ivo_score', { ascending: false, nullsFirst: false }).limit(150),
    supabase.from('aml_entity_lifecycle_v0680').select('entity_id,event_date,refreshed_at').eq('event_type', 'SII_TERMINO_GIRO').order('refreshed_at', { ascending: false }).limit(100),
  ]);

  const errors = [sourceResult.error, sanctionResult.error, pressResult.error, potentialResult.error, termResult.error].filter(Boolean);
  if (errors.length === 5) throw new Error(errors.map((item) => item?.message).filter(Boolean).join(' · '));

  const sanctions = sanctionResult.data ?? [];
  const press = pressResult.data ?? [];
  const terms = termResult.data ?? [];
  const evidenceRuts = Array.from(new Set([...sanctions, ...press].map((row) => row.rut).filter(Boolean))) as string[];
  const termEntityIds = Array.from(new Set(terms.map((row) => row.entity_id).filter(Boolean))) as string[];

  const [evidenceSubjectsResult, termSubjectsResult] = await Promise.all([
    evidenceRuts.length
      ? supabase.from('obs_uaf_subject').select('rut,entity_id,name,uaf_sector').in('rut', evidenceRuts)
      : Promise.resolve({ data: [], error: null }),
    termEntityIds.length
      ? supabase.from('obs_uaf_subject').select('entity_id,name,uaf_sector').in('entity_id', termEntityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const evidenceSubjects = (evidenceSubjectsResult.data ?? []) as Array<{ rut: string; entity_id: string; name: string; uaf_sector: string | null }>;
  const termSubjects = (termSubjectsResult.data ?? []) as Array<{ entity_id: string; name: string; uaf_sector: string | null }>;
  const byRut = new Map(evidenceSubjects.map((row) => [row.rut, row]));
  const byEntity = new Map(termSubjects.map((row) => [row.entity_id, row]));
  const items: UpdateItem[] = [];

  const sanction = sanctions.find((row) => row.rut && byRut.has(row.rut));
  if (sanction?.rut) {
    const subject = byRut.get(sanction.rut)!;
    items.push({
      id: `sancion:${sanction.evidence_id}`, kind: 'SANCION', event_at: sanction.event_date ?? sanction.refreshed_at,
      title: sanction.headline || `${subject.name} · antecedente sancionatorio`, detail: sanction.summary || subject.uaf_sector,
      source_label: sanction.source_label, source_url: sanction.has_link ? sanction.document_url : null,
      entity_id: subject.entity_id, entity_name: subject.name, meta: 'SO inscrito · sanción', priority_group: 1,
      priority_label: PRIORITY_LABEL[1], action_hash: null, action_label: 'Abrir ficha',
    });
  }

  const pressRow = press.find((row) => row.rut && byRut.has(row.rut));
  if (pressRow?.rut) {
    const subject = byRut.get(pressRow.rut)!;
    items.push({
      id: `prensa:${pressRow.evidence_id}`, kind: 'PRENSA', event_at: pressRow.event_date ?? pressRow.refreshed_at,
      title: pressRow.headline || `${subject.name} · nueva mención en prensa`, detail: pressRow.summary || subject.uaf_sector,
      source_label: pressRow.source_label ?? 'Prensa', source_url: pressRow.has_link ? pressRow.document_url : null,
      entity_id: subject.entity_id, entity_name: subject.name, meta: 'SO inscrito · prensa', priority_group: 1,
      priority_label: PRIORITY_LABEL[1], action_hash: null, action_label: 'Abrir ficha',
    });
  }

  const candidates = (potentialResult.data ?? []) as Array<{
    rut: string; entity_id: string | null; name: string; implied_sector: string | null; matched_activity: string | null;
    sii_activity_start_date: string | null; ivo_score: number | string | null; refreshed_at: string;
  }>;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const newestCompany = candidates
    .filter((row) => row.sii_activity_start_date && new Date(`${row.sii_activity_start_date}T00:00:00Z`).getTime() >= oneYearAgo)
    .sort((a, b) => sortableDate(b.sii_activity_start_date ?? '') - sortableDate(a.sii_activity_start_date ?? ''))[0];
  const radarCandidate = candidates
    .filter((row) => row.rut !== newestCompany?.rut)
    .sort((a, b) => Number(b.ivo_score ?? 0) - Number(a.ivo_score ?? 0))[0];

  for (const [candidate, candidateKind] of [[newestCompany, 'EMPRESA_NUEVA'], [radarCandidate, 'RADAR']] as const) {
    if (!candidate) continue;
    const newCompany = candidateKind === 'EMPRESA_NUEVA';
    items.push({
      id: `potencial:${candidate.rut}:${candidateKind.toLowerCase()}`, kind: 'POTENCIAL',
      event_at: newCompany ? candidate.sii_activity_start_date! : candidate.refreshed_at,
      title: `${candidate.name} · ${newCompany ? 'empresa nueva con giro relacionado' : 'potencial SO observado en Radar'}`,
      detail: [candidate.implied_sector, candidate.matched_activity, candidate.ivo_score != null ? `IVO ${Number(candidate.ivo_score).toFixed(1)}` : null].filter(Boolean).join(' · '),
      source_label: 'Radar SII · screening potenciales', source_url: null, entity_id: candidate.entity_id, entity_name: candidate.name,
      meta: newCompany ? 'Empresa nueva · hipótesis de registro' : 'Screening · hipótesis de registro', priority_group: 2,
      priority_label: PRIORITY_LABEL[2], action_hash: hrefFor({ view: 'universo', mode: 'casos', cola: 'potenciales' }), action_label: 'Revisar potencial',
    });
  }

  const matchedTerms = terms.map((row) => ({ ...row, subject: byEntity.get(row.entity_id) })).filter((row) => row.subject && row.refreshed_at);
  const latestTermRefresh = Math.max(0, ...matchedTerms.map((row) => sortableDate(row.refreshed_at)));
  const latestBatch = matchedTerms.filter((row) => sortableDate(row.refreshed_at) >= latestTermRefresh - 24 * 60 * 60 * 1000);
  if (latestBatch.length) {
    const latestEvent = latestBatch.map((row) => row.event_date).filter(Boolean).sort().at(-1) ?? null;
    items.push({
      id: `baja-so:${latestTermRefresh}`, kind: 'BAJA_SO', event_at: new Date(latestTermRefresh).toISOString(),
      title: `${latestBatch.length} SO con término de giro en la última actualización`,
      detail: `Términos registrados hasta ${latestEvent ?? 'fecha no informada'} · revisar cancelación o desvinculación del padrón.`,
      source_label: 'Radar SII × padrón UAF', source_url: null, entity_id: null, entity_name: null,
      meta: 'Acción de gestión · revisar cancelación', priority_group: 3, priority_label: PRIORITY_LABEL[3],
      action_hash: hrefFor({ view: 'universo', mode: 'casos', cola: 'termino' }), action_label: 'Revisar bajas',
    });
  }

  const sources = (sourceResult.data ?? []) as Array<{
    source_code: string; source_name: string; software_status: string | null; data_status: string | null;
    records_24h: number | string | null; refreshed_at: string;
  }>;
  const severity = (row: typeof sources[number]) => {
    const software = String(row.software_status ?? '').toLowerCase();
    const dataStatus = String(row.data_status ?? '').toLowerCase();
    if (['error', 'blocked', 'down', 'failed'].includes(software) || ['error', 'blocked', 'stale', 'failed'].includes(dataStatus)) return 1;
    if (software === 'watch' || dataStatus === 'silent') return 2;
    return 9;
  };
  const criticalSources = sources.filter((row) => severity(row) === 1);
  const watch = sources.filter((row) => severity(row) === 2);
  const freshRadars = sources.filter((row) => row.source_code.startsWith('RADAR_') && String(row.data_status).toLowerCase() === 'fresh');
  const issueNames = [...criticalSources, ...watch].slice(0, 3).map((row) => row.source_name).join(' · ');
  const radarRecords = sources.filter((row) => row.source_code.startsWith('RADAR_')).reduce((sum, row) => sum + Number(row.records_24h ?? 0), 0);
  const latestSource = Math.max(0, ...sources.map((row) => sortableDate(row.refreshed_at)));
  items.push({
    id: `fuentes:${latestSource}`, kind: 'FUENTE', event_at: latestSource ? new Date(latestSource).toISOString() : new Date().toISOString(),
    title: criticalSources.length ? `${criticalSources.length} fuente(s) con bloqueo o error` : watch.length ? `${watch.length} fuente(s) requieren vigilancia` : `${freshRadars.length} radares actualizados sin incidencias declaradas`,
    detail: [issueNames || null, `${freshRadars.length} radares fresh`, `${radarRecords.toLocaleString('es-CL')} registros en 24 h`].filter(Boolean).join(' · '),
    source_label: 'Salud de fuentes', source_url: null, entity_id: null, entity_name: null,
    meta: criticalSources.length ? 'INCIDENCIA' : watch.length ? 'VIGILAR' : 'OPERATIVO', priority_group: 4,
    priority_label: PRIORITY_LABEL[4], action_hash: hrefFor({ view: 'fuentes' }), action_label: 'Ver fuentes',
  });

  items.sort((a, b) => priorityFor(a) - priorityFor(b) || sortableDate(b.event_at) - sortableDate(a.event_at));
  return {
    contract: 'ATLAS_OBS_UAF_UPDATES_V2', generated_at: new Date().toISOString(), items: items.slice(0, 8), semantics: SEMANTICS,
  };
}

function sortableDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const millis = new Date(normalized).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function formatEvent(value: string) {
  if (!value) return '—';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
  const d = new Date(value.includes(' ') ? value.replace(' ', 'T') : value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

function formatGenerated(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'recientemente';
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(d);
}

function formatMatchBasis(value: string) {
  if (value.includes('RUT_EXACT')) return 'RUT exacto';
  if (value.includes('CURATED')) return 'alias validado';
  if (value.includes('LEGAL_NAME_EXACT')) return 'razón social exacta';
  return 'resolución estricta';
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}
