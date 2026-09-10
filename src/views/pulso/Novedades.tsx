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

/**
 * Feed operativo del Pulso. No intenta inferir riesgo: muestra hechos nuevos o
 * nuevas sincronizaciones que cambian lo que el analista puede observar.
 * Conserva la última respuesta mientras refresca para evitar parpadeos.
 */
export function NovedadesObservatorio() {
  const [feed, setFeed] = useState<UpdatesFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('obs_uaf_updates');
      if (rpcError) throw rpcError;
      setFeed(data as UpdatesFeed);
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No fue posible sincronizar las novedades.';
      setError(message);
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

  const items = feed?.items ?? [];

  return (
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
                  {item.detail && <p>{item.detail}</p>}
                  <div className="pulse-update-foot">
                    <span>{item.source_label ?? item.meta ?? 'Atlas'}</span>
                    <span className="pulse-update-links">
                      {item.entity_id && (
                        <a href={hrefFor({ view: 'ficha', entityId: item.entity_id })}>
                          Ficha →
                        </a>
                      )}
                      {item.source_url && (
                        <a href={item.source_url} target="_blank" rel="noreferrer">
                          Fuente ↗
                        </a>
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
  );
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
  return new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}
