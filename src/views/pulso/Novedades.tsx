import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../components/primitives';
import { hrefFor } from '../../lib/router';
import { supabase } from '../../lib/supabase';
import './Novedades.css';

type UpdateKind = 'CORTE' | 'PRENSA' | 'FUENTE' | 'SANCION' | 'ESTADO';

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
}

interface UpdatesFeed {
  contract: 'ATLAS_OBS_UAF_UPDATES_V1';
  generated_at: string;
  items: UpdateItem[];
  semantics: string;
}

const LABEL: Record<UpdateKind, string> = {
  CORTE: 'CORTE',
  PRENSA: 'PRENSA',
  FUENTE: 'RADAR',
  SANCION: 'SANCIÓN',
  ESTADO: 'ESTADO SO',
};

const SEMANTICS = 'Novedades observadas por Atlas. Combina cambios de ciclo de vida de sujetos obligados, antecedentes sancionatorios y actualizaciones de fuentes. Una actualización de fuente indica nueva sincronización o registros observados; no implica por sí sola un hallazgo de riesgo.';

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
      // Un fallo de este RPC no es evidencia de una sesión vencida. Supabase
      // renueva el token de forma automática; forzar refreshSession() aquí
      // dispara TOKEN_REFRESHED y puede hacer que la capa de autorización
      // desmonte y vuelva a montar toda la aplicación. Caemos directamente al
      // read model alternativo sin tocar la sesión del usuario.
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

  const items = (feed?.items ?? []).slice(0, compact ? 4 : 8);

  return (
    <div className={compact ? 'pulse-updates-compact' : undefined}>
      <Panel
        title="Novedades del observatorio"
        pad={false}
        actions={
          <div className="pulse-updates-actions">
            <span className="pulse-updates-live" title="El cuadro se vuelve a consultar automáticamente cada 5 minutos">
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
            <div className="pulse-updates-state">Leyendo novedades de Atlas…</div>
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
                <article className="pulse-update" data-kind={item.kind} key={item.id}>
                  <div className="pulse-update-rail"><i /></div>
                  <div className="pulse-update-body">
                    <div className="pulse-update-topline">
                      <span className="pulse-update-kind">{LABEL[item.kind]}</span>
                      <time dateTime={item.event_at}>{formatEvent(item.event_at)}</time>
                    </div>
                    <h4>{item.title}</h4>
                    {!compact && item.detail && <p>{item.detail}</p>}
                    <div className="pulse-update-foot">
                      <span>{item.source_label ?? item.meta ?? 'Atlas'}</span>
                      <span className="pulse-update-links">
                        {item.entity_id && (
                          <a href={hrefFor({ view: 'ficha', entityId: item.entity_id })}>Ficha →</a>
                        )}
                        {item.source_url && (
                          <a href={item.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>
                        )}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="pulse-updates-caption">
            <span>
              {feed?.generated_at ? `Actualizado ${formatGenerated(feed.generated_at)}` : 'Actualización automática cada 5 min'}
            </span>
            {error && feed && <em title={error}>última sincronización no disponible</em>}
          </div>
        </div>
      </Panel>
    </div>
  );
}

async function loadRpcFeed(): Promise<UpdatesFeed> {
  const { data, error } = await supabase.rpc('obs_uaf_updates');
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('El feed de novedades no devolvió un contrato válido.');
  return data as UpdatesFeed;
}

async function loadDirectFeed(): Promise<UpdatesFeed> {
  const [sourceResult, sanctionResult, lifecycleResult, snapshotResult] = await Promise.all([
    supabase
      .from('obs_source_health')
      .select('source_code,source_name,last_successful_ingest_at,refreshed_at,records_24h,data_status')
      .like('source_code', 'RADAR_%')
      .order('last_successful_ingest_at', { ascending: false, nullsFirst: false })
      .limit(8),
    supabase
      .from('obs_uaf_evidence')
      .select('evidence_id,rut,event_date,refreshed_at,headline,summary,source_label,document_url,has_link')
      .eq('kind', 'SANCION')
      .not('event_date', 'is', null)
      .order('event_date', { ascending: false })
      .limit(2),
    supabase
      .from('aml_entity_lifecycle_v0680')
      .select('entity_id,event_date,event_type,event_label,source_system,source_url,refreshed_at')
      .in('event_type', ['SII_TERMINO_GIRO', 'SII_INICIO_ACTIVIDADES'])
      .order('event_date', { ascending: false, nullsFirst: false })
      .limit(5),
    supabase
      .from('obs_snapshot')
      .select('snapshot_id,generated_at,status,published_at')
      .order('generated_at', { ascending: false })
      .limit(1),
  ]);

  const errors = [sourceResult.error, sanctionResult.error, lifecycleResult.error, snapshotResult.error].filter(Boolean);
  if (errors.length === 4) throw new Error(errors.map((item) => item?.message).filter(Boolean).join(' · '));

  const lifecycleRows = lifecycleResult.data ?? [];
  const sanctionRows = sanctionResult.data ?? [];
  const entityIds = Array.from(new Set(lifecycleRows.map((row) => row.entity_id).filter(Boolean)));
  const sanctionRuts = Array.from(new Set(sanctionRows.map((row) => row.rut).filter(Boolean)));

  let stateSubjects: Array<{ entity_id: string; name: string; uaf_sector: string | null }> = [];
  let sanctionSubjects: Array<{ rut: string; entity_id: string; name: string; uaf_sector: string | null }> = [];

  if (entityIds.length) {
    const { data } = await supabase
      .from('obs_uaf_subject')
      .select('entity_id,name,uaf_sector')
      .in('entity_id', entityIds);
    stateSubjects = (data ?? []) as typeof stateSubjects;
  }

  if (sanctionRuts.length) {
    const { data } = await supabase
      .from('obs_uaf_subject')
      .select('rut,entity_id,name,uaf_sector')
      .in('rut', sanctionRuts);
    sanctionSubjects = (data ?? []) as typeof sanctionSubjects;
  }

  const stateById = new Map(stateSubjects.map((row) => [row.entity_id, row]));
  const sanctionByRut = new Map(sanctionSubjects.map((row) => [row.rut, row]));
  const items: UpdateItem[] = [];

  for (const row of snapshotResult.data ?? []) {
    const eventAt = row.published_at ?? row.generated_at;
    if (!eventAt) continue;
    items.push({
      id: `corte:${row.snapshot_id}`,
      kind: 'CORTE',
      event_at: eventAt,
      title: 'Nuevo corte del Observatorio disponible',
      detail: `Snapshot ${row.snapshot_id} · estado ${String(row.status ?? 'publicado').toLowerCase()}`,
      source_label: 'Atlas Observatorio',
      source_url: null,
      entity_id: null,
      entity_name: null,
      meta: 'Corte',
    });
  }

  const sourceRows = (sourceResult.data ?? [])
    .filter((row) => row.source_code === 'RADAR_PRENSA' || Number(row.records_24h ?? 0) > 0)
    .slice(0, 3);

  for (const row of sourceRows) {
    const eventAt = row.last_successful_ingest_at ?? row.refreshed_at;
    if (!eventAt) continue;
    const count = Number(row.records_24h ?? 0);
    const isPress = row.source_code === 'RADAR_PRENSA';
    const sourceName = row.source_name ?? row.source_code;
    items.push({
      id: `source:${row.source_code}`,
      kind: isPress ? 'PRENSA' : 'FUENTE',
      event_at: eventAt,
      title: isPress ? 'Radar Prensa · índice actualizado' : `${String(sourceName).replace(/\s*·.*$/, '')} · fuente actualizada`,
      detail: count > 0 ? `${count.toLocaleString('es-CL')} registros observados en las últimas 24 h` : 'Fuente sincronizada en el último corte',
      source_label: sourceName,
      source_url: null,
      entity_id: null,
      entity_name: null,
      meta: String(row.data_status ?? 'actualizada').toUpperCase(),
    });
  }

  for (const row of sanctionRows) {
    const subject = row.rut ? sanctionByRut.get(row.rut) : undefined;
    const eventAt = row.event_date ?? row.refreshed_at;
    if (!eventAt) continue;
    items.push({
      id: `sancion:${row.evidence_id}`,
      kind: 'SANCION',
      event_at: eventAt,
      title: row.headline || `${subject?.name ?? row.rut ?? 'Entidad'} · nuevo antecedente sancionatorio`,
      detail: row.summary && row.summary !== row.headline ? row.summary : subject?.uaf_sector ?? null,
      source_label: row.source_label,
      source_url: row.has_link ? row.document_url : null,
      entity_id: subject?.entity_id ?? null,
      entity_name: subject?.name ?? null,
      meta: 'Antecedente sancionatorio',
    });
  }

  for (const row of lifecycleRows) {
    const subject = stateById.get(row.entity_id);
    if (!subject) continue;
    const eventAt = row.event_date ?? row.refreshed_at;
    if (!eventAt) continue;
    const ending = row.event_type === 'SII_TERMINO_GIRO';
    items.push({
      id: `estado:${row.entity_id}:${row.event_type}:${row.event_date ?? 'sin-fecha'}`,
      kind: 'ESTADO',
      event_at: eventAt,
      title: `${subject.name} · ${ending ? 'término de giro' : 'inicio de actividades'}`,
      detail: subject.uaf_sector ?? row.event_label ?? null,
      source_label: row.source_system ?? 'SII',
      source_url: row.source_url ?? null,
      entity_id: row.entity_id,
      entity_name: subject.name,
      meta: ending ? 'Estado tributario' : 'Ciclo de vida',
    });
  }

  items.sort((a, b) => sortableDate(b.event_at) - sortableDate(a.event_at));

  return {
    contract: 'ATLAS_OBS_UAF_UPDATES_V1',
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
