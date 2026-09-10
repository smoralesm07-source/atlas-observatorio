import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../components/primitives';
import { hrefFor } from '../../lib/router';
import { supabase } from '../../lib/supabase';
import './Novedades.css';

type UpdateKind = 'CORTE' | 'PRENSA' | 'FUENTE' | 'SANCION' | 'ESTADO' | 'POTENCIAL' | 'BAJA_SO';
type PriorityGroup = 1 | 2 | 3 | 4;

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
}

interface UpdatesFeed {
  contract: 'ATLAS_OBS_UAF_UPDATES_V1' | 'ATLAS_OBS_UAF_UPDATES_V2';
  generated_at: string;
  items: UpdateItem[];
  semantics: string;
}

const LABEL: Record<UpdateKind, string> = {
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

const SEMANTICS = 'Novedades operativas priorizadas: primero hechos sobre sujetos obligados inscritos; luego potenciales SO, empresas nuevas o nuevos giros relacionados; después términos de giro del último lote para revisión de cancelación; finalmente salud e incidencias de radares y fuentes. Las señales de potenciales son hipótesis de registro y no acreditan incumplimiento.';

export function NovedadesObservatorio({ compact = false }: { compact?: boolean }) {
  const [feed, setFeed] = useState<UpdatesFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const rpcFeed = await loadRpcFeed();
      setFeed(rpcFeed);
      setError(null);
      return;
    } catch (firstError) {
      // Un fallo del feed nunca debe tocar la sesión del usuario. La ruta
      // alternativa sólo lee modelos ya expuestos por Atlas.
      try {
        const directFeed = await loadDirectFeed();
        setFeed(directFeed);
        setError(null);
      } catch (fallbackError) {
        const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        setError(`${firstMessage} · ${fallbackMessage}`);
      }
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
  const items = compact ? selectCompactPriorities(allItems) : allItems.slice(0, 8);

  return (
    <div className={compact ? 'pulse-updates-compact' : undefined}>
      <Panel
        title="Novedades prioritarias"
        pad={false}
        actions={
          <div className="pulse-updates-actions">
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
              {items.map((item) => {
                const priority = priorityFor(item);
                return (
                  <article
                    className="pulse-update"
                    data-kind={item.kind}
                    data-priority={priority}
                    key={item.id}
                  >
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
                          {item.action_hash && (
                            <a href={item.action_hash}>{item.action_label ?? 'Abrir'} →</a>
                          )}
                          {item.entity_id && (!item.action_hash || !compact) && (
                            <a href={hrefFor({ view: 'ficha', entityId: item.entity_id })}>Ficha →</a>
                          )}
                          {item.source_url && (
                            <a href={item.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>
                          )}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="pulse-updates-caption">
            <span>{feed?.generated_at ? `Actualizado ${formatGenerated(feed.generated_at)}` : 'Prioridad operativa Atlas'}</span>
            {error && feed && <em title={error}>última sincronización no disponible</em>}
          </div>
        </div>
      </Panel>
    </div>
  );
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
  if (item.priority_group && item.priority_group >= 1 && item.priority_group <= 4) return item.priority_group;
  if (item.kind === 'POTENCIAL') return 2;
  if (item.kind === 'BAJA_SO') return 3;
  if (item.kind === 'FUENTE' || item.kind === 'CORTE') return 4;
  return 1;
}

function selectCompactPriorities(items: UpdateItem[]) {
  const picked: UpdateItem[] = [];
  for (const priority of [1, 2, 3, 4] as PriorityGroup[]) {
    const match = items.find((item) => priorityFor(item) === priority);
    if (match) picked.push(match);
  }
  if (picked.length < 4) {
    for (const item of items) {
      if (picked.some((current) => current.id === item.id)) continue;
      picked.push(item);
      if (picked.length === 4) break;
    }
  }
  return picked.slice(0, 4);
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

async function loadDirectFeed(): Promise<UpdatesFeed> {
  const [sourceResult, sanctionResult, pressResult, potentialResult, termResult] = await Promise.all([
    supabase
      .from('obs_source_health')
      .select('source_code,source_name,software_status,data_status,records_24h,refreshed_at'),
    supabase
      .from('obs_uaf_evidence')
      .select('evidence_id,rut,event_date,refreshed_at,headline,summary,source_label,document_url,has_link')
      .eq('kind', 'SANCION')
      .order('event_date', { ascending: false, nullsFirst: false })
      .limit(8),
    supabase
      .from('obs_uaf_evidence')
      .select('evidence_id,rut,event_date,refreshed_at,headline,summary,source_label,document_url,has_link')
      .eq('kind', 'PRENSA')
      .order('refreshed_at', { ascending: false })
      .limit(8),
    supabase
      .from('obs_uaf_potential_candidate')
      .select('rut,entity_id,name,implied_sector,matched_activity,sii_activity_start_date,ivo_score,refreshed_at')
      .order('ivo_score', { ascending: false, nullsFirst: false })
      .limit(150),
    supabase
      .from('aml_entity_lifecycle_v0680')
      .select('entity_id,event_date,refreshed_at')
      .eq('event_type', 'SII_TERMINO_GIRO')
      .order('refreshed_at', { ascending: false })
      .limit(100),
  ]);

  const errors = [sourceResult.error, sanctionResult.error, pressResult.error, potentialResult.error, termResult.error].filter(Boolean);
  if (errors.length === 5) throw new Error(errors.map((item) => item?.message).filter(Boolean).join(' · '));

  const sanctions = sanctionResult.data ?? [];
  const press = pressResult.data ?? [];
  const terms = termResult.data ?? [];
  const evidenceRuts = Array.from(new Set([...sanctions, ...press].map((row) => row.rut).filter(Boolean)));
  const termEntityIds = Array.from(new Set(terms.map((row) => row.entity_id).filter(Boolean)));

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
      id: `sancion:${sanction.evidence_id}`,
      kind: 'SANCION',
      event_at: sanction.event_date ?? sanction.refreshed_at,
      title: sanction.headline || `${subject.name} · antecedente sancionatorio`,
      detail: sanction.summary || subject.uaf_sector,
      source_label: sanction.source_label,
      source_url: sanction.has_link ? sanction.document_url : null,
      entity_id: subject.entity_id,
      entity_name: subject.name,
      meta: 'SO inscrito · sanción',
      priority_group: 1,
      priority_label: PRIORITY_LABEL[1],
      action_hash: null,
      action_label: 'Abrir ficha',
    });
  }

  const pressRow = press.find((row) => row.rut && byRut.has(row.rut));
  if (pressRow?.rut) {
    const subject = byRut.get(pressRow.rut)!;
    items.push({
      id: `prensa:${pressRow.evidence_id}`,
      kind: 'PRENSA',
      event_at: pressRow.event_date ?? pressRow.refreshed_at,
      title: pressRow.headline || `${subject.name} · nueva mención en prensa`,
      detail: pressRow.summary || subject.uaf_sector,
      source_label: pressRow.source_label ?? 'Prensa',
      source_url: pressRow.has_link ? pressRow.document_url : null,
      entity_id: subject.entity_id,
      entity_name: subject.name,
      meta: 'SO inscrito · prensa',
      priority_group: 1,
      priority_label: PRIORITY_LABEL[1],
      action_hash: null,
      action_label: 'Abrir ficha',
    });
  }

  const candidates = (potentialResult.data ?? []) as Array<{
    rut: string;
    entity_id: string | null;
    name: string;
    implied_sector: string | null;
    matched_activity: string | null;
    sii_activity_start_date: string | null;
    ivo_score: number | string | null;
    refreshed_at: string;
  }>;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const newestCompany = candidates
    .filter((row) => row.sii_activity_start_date && new Date(`${row.sii_activity_start_date}T00:00:00Z`).getTime() >= oneYearAgo)
    .sort((a, b) => sortableDate(b.sii_activity_start_date ?? '') - sortableDate(a.sii_activity_start_date ?? ''))[0];
  const radarCandidate = candidates
    .filter((row) => row.rut !== newestCompany?.rut)
    .sort((a, b) => Number(b.ivo_score ?? 0) - Number(a.ivo_score ?? 0))[0];

  for (const [candidate, kind] of [[newestCompany, 'EMPRESA_NUEVA'], [radarCandidate, 'RADAR']] as const) {
    if (!candidate) continue;
    const newCompany = kind === 'EMPRESA_NUEVA';
    items.push({
      id: `potencial:${candidate.rut}:${kind.toLowerCase()}`,
      kind: 'POTENCIAL',
      event_at: newCompany ? candidate.sii_activity_start_date! : candidate.refreshed_at,
      title: `${candidate.name} · ${newCompany ? 'empresa nueva con giro relacionado' : 'potencial SO observado en Radar'}`,
      detail: [candidate.implied_sector, candidate.matched_activity, candidate.ivo_score != null ? `IVO ${Number(candidate.ivo_score).toFixed(1)}` : null].filter(Boolean).join(' · '),
      source_label: 'Radar SII · screening potenciales',
      source_url: null,
      entity_id: candidate.entity_id,
      entity_name: candidate.name,
      meta: newCompany ? 'Empresa nueva · hipótesis de registro' : 'Screening · hipótesis de registro',
      priority_group: 2,
      priority_label: PRIORITY_LABEL[2],
      action_hash: hrefFor({ view: 'universo', mode: 'casos', cola: 'potenciales' }),
      action_label: 'Revisar potencial',
    });
  }

  const matchedTerms = terms
    .map((row) => ({ ...row, subject: byEntity.get(row.entity_id) }))
    .filter((row) => row.subject && row.refreshed_at);
  const latestTermRefresh = Math.max(0, ...matchedTerms.map((row) => sortableDate(row.refreshed_at)));
  const latestBatch = matchedTerms.filter((row) => sortableDate(row.refreshed_at) >= latestTermRefresh - 24 * 60 * 60 * 1000);
  if (latestBatch.length) {
    const latestEvent = latestBatch
      .map((row) => row.event_date)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    items.push({
      id: `baja-so:${latestTermRefresh}`,
      kind: 'BAJA_SO',
      event_at: new Date(latestTermRefresh).toISOString(),
      title: `${latestBatch.length} SO con término de giro en la última actualización`,
      detail: `Términos registrados hasta ${latestEvent ?? 'fecha no informada'} · revisar cancelación o desvinculación del padrón.`,
      source_label: 'Radar SII × padrón UAF',
      source_url: null,
      entity_id: null,
      entity_name: null,
      meta: 'Acción de gestión · revisar cancelación',
      priority_group: 3,
      priority_label: PRIORITY_LABEL[3],
      action_hash: hrefFor({ view: 'universo', mode: 'casos', cola: 'termino' }),
      action_label: 'Revisar bajas',
    });
  }

  const sources = (sourceResult.data ?? []) as Array<{
    source_code: string;
    source_name: string;
    software_status: string | null;
    data_status: string | null;
    records_24h: number | string | null;
    refreshed_at: string;
  }>;
  const severity = (row: typeof sources[number]) => {
    const software = String(row.software_status ?? '').toLowerCase();
    const data = String(row.data_status ?? '').toLowerCase();
    if (['error', 'blocked', 'down', 'failed'].includes(software) || ['error', 'blocked', 'stale', 'failed'].includes(data)) return 1;
    if (software === 'watch' || data === 'silent') return 2;
    return 9;
  };
  const critical = sources.filter((row) => severity(row) === 1);
  const watch = sources.filter((row) => severity(row) === 2);
  const freshRadars = sources.filter((row) => row.source_code.startsWith('RADAR_') && String(row.data_status).toLowerCase() === 'fresh');
  const issueNames = [...critical, ...watch].slice(0, 3).map((row) => row.source_name).join(' · ');
  const radarRecords = sources
    .filter((row) => row.source_code.startsWith('RADAR_'))
    .reduce((sum, row) => sum + Number(row.records_24h ?? 0), 0);
  const latestSource = Math.max(0, ...sources.map((row) => sortableDate(row.refreshed_at)));
  items.push({
    id: `fuentes:${latestSource}`,
    kind: 'FUENTE',
    event_at: latestSource ? new Date(latestSource).toISOString() : new Date().toISOString(),
    title: critical.length
      ? `${critical.length} fuente(s) con bloqueo o error`
      : watch.length
        ? `${watch.length} fuente(s) requieren vigilancia`
        : `${freshRadars.length} radares actualizados sin incidencias declaradas`,
    detail: [issueNames || null, `${freshRadars.length} radares fresh`, `${radarRecords.toLocaleString('es-CL')} registros en 24 h`].filter(Boolean).join(' · '),
    source_label: 'Salud de fuentes',
    source_url: null,
    entity_id: null,
    entity_name: null,
    meta: critical.length ? 'INCIDENCIA' : watch.length ? 'VIGILAR' : 'OPERATIVO',
    priority_group: 4,
    priority_label: PRIORITY_LABEL[4],
    action_hash: hrefFor({ view: 'fuentes' }),
    action_label: 'Ver fuentes',
  });

  items.sort((a, b) => priorityFor(a) - priorityFor(b) || sortableDate(b.event_at) - sortableDate(a.event_at));
  return {
    contract: 'ATLAS_OBS_UAF_UPDATES_V2',
    generated_at: new Date().toISOString(),
    items: items.slice(0, 8),
    semantics: SEMANTICS,
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
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(d);
  }
  const d = new Date(value.includes(' ') ? value.replace(' ', 'T') : value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

function formatGenerated(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'recientemente';
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' }).format(d);
}
