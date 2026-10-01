import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/state-counterparty-drawer.css';

export type StateCounterpartySelection = {
  kind: 'buyer' | 'payer';
  label: string;
  identifier?: string | null;
  amount?: number | null;
  count?: number | null;
  firstYear?: number | null;
  lastYear?: number | null;
  supplierRole?: boolean | null;
  recipientRole?: boolean | null;
};

type Candidate = {
  entity_id: string;
  rut?: string | null;
  name: string;
  entity_type?: string | null;
  region?: string | null;
  commune?: string | null;
  source_count?: number | null;
  identity_assertion?: boolean;
  match_type?: string | null;
  match_score?: number | null;
  openable?: boolean;
};

type SearchResponse = { items?: Candidate[] };

type ResolutionState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  candidates: Candidate[];
  error?: string;
};

function normRut(value: string | null | undefined) {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function normName(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clp(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(Number(value));
}

function count(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toLocaleString('es-CL');
}

function period(item: StateCounterpartySelection) {
  if (!item.firstYear && !item.lastYear) return '—';
  if (item.firstYear === item.lastYear) return String(item.firstYear ?? item.lastYear);
  return `${item.firstYear ?? '…'}–${item.lastYear ?? '…'}`;
}

function scoreLabel(candidate: Candidate) {
  const score = Number(candidate.match_score ?? 0);
  if (!Number.isFinite(score) || score <= 0) return null;
  const pct = score <= 1 ? score * 100 : score;
  return `${Math.round(pct)}% coincidencia`;
}

export function StateCounterpartyDrawer({
  item,
  onClose,
  onNavigate,
}: {
  item: StateCounterpartySelection | null;
  onClose: () => void;
  onNavigate: (hash: string) => void;
}) {
  const [resolution, setResolution] = useState<ResolutionState>({ status: 'idle', candidates: [] });

  useEffect(() => {
    if (!item) {
      setResolution({ status: 'idle', candidates: [] });
      return;
    }

    let cancelled = false;
    const search = item.kind === 'buyer' && item.identifier ? item.identifier : item.label;
    if (!search || search.trim().length < 2) {
      setResolution({ status: 'done', candidates: [] });
      return;
    }

    setResolution({ status: 'loading', candidates: [] });
    const run = async () => {
      try {
        const { data, error } = await supabase.rpc('atlas_v2_entity_search_cascade', {
          p_request: {
            kind: 'results',
            search,
            limit: 5,
            offset: 0,
            region: '',
            entity_type: '',
            uaf: false,
            sanctioned: false,
            min_sources: 0,
          },
        });
        if (cancelled) return;
        if (error) {
          setResolution({ status: 'error', candidates: [], error: error.message });
          return;
        }
        const candidates = ((data as SearchResponse | null)?.items ?? []).slice(0, 5);
        setResolution({ status: 'done', candidates });
      } catch (error) {
        if (cancelled) return;
        setResolution({
          status: 'error', candidates: [],
          error: error instanceof Error ? error.message : 'No fue posible resolver la contraparte.',
        });
      }
    };
    void run();

    return () => { cancelled = true; };
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  const exact = useMemo(() => {
    if (!item || !resolution.candidates.length) return null;
    if (item.kind === 'buyer' && item.identifier) {
      const target = normRut(item.identifier);
      return resolution.candidates.find((candidate) => normRut(candidate.rut) === target) ?? null;
    }
    const target = normName(item.label);
    const exactNames = resolution.candidates.filter((candidate) => normName(candidate.name) === target);
    return exactNames.length === 1 ? exactNames[0] : null;
  }, [item, resolution.candidates]);

  if (!item) return null;

  const source = item.kind === 'buyer' ? 'Mercado Público' : 'Presupuesto Abierto';
  const recordLabel = item.kind === 'buyer' ? 'órdenes de compra' : 'transacciones';
  const roles = [item.supplierRole ? 'Pago como proveedor' : null, item.recipientRole ? 'Traspaso / receptor' : null].filter(Boolean);

  const open = (candidate: Candidate) => {
    onClose();
    onNavigate(`#/entidad/${encodeURIComponent(candidate.entity_id)}`);
  };

  return (
    <div className="state-counterparty-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="state-counterparty-drawer" role="dialog" aria-modal="true" aria-label="Detalle de contraparte pública">
        <header className="state-counterparty-head">
          <div>
            <span>{item.kind === 'buyer' ? 'Organismo comprador' : 'Organismo pagador'}</span>
            <h3>{item.label}</h3>
            <small>{source}{item.identifier ? ` · ${item.identifier}` : ''}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar detalle">×</button>
        </header>

        <section className="state-counterparty-facts">
          <div><span>Monto observado</span><strong>{clp(item.amount)}</strong></div>
          <div><span>{recordLabel}</span><strong>{count(item.count)}</strong></div>
          <div><span>Período</span><strong>{period(item)}</strong></div>
        </section>

        {item.kind === 'payer' && (
          <section className="state-counterparty-source-note">
            <strong>Qué representa esta contraparte</strong>
            <p>Presupuesto Abierto identifica al organismo pagador mediante una clave administrativa. Atlas conserva esa identidad de fuente y sólo la enlaza con Entidad 360 cuando encuentra una equivalencia suficientemente clara.</p>
            {roles.length > 0 && <div>{roles.map((role) => <span key={String(role)}>{role}</span>)}</div>}
          </section>
        )}

        <section className="state-counterparty-resolution">
          <div className="state-counterparty-section-title">
            <div><span>Identidad Atlas</span><strong>{item.kind === 'buyer' ? 'Resolución por RUT' : 'Resolución por nombre'}</strong></div>
            {exact && <em>resuelta</em>}
          </div>

          {resolution.status === 'loading' && <div className="state-counterparty-status">Buscando una entidad equivalente en Atlas…</div>}
          {resolution.status === 'error' && <div className="state-counterparty-status" data-tone="error">No fue posible resolver la identidad en esta consulta. La ficha de fuente sigue siendo válida.</div>}

          {resolution.status === 'done' && exact && (
            <button type="button" className="state-counterparty-exact" onClick={() => open(exact)}>
              <span><strong>{exact.name}</strong><small>{[exact.rut, exact.entity_type, exact.commune, exact.region].filter(Boolean).join(' · ')}</small></span>
              <b>Entidad 360 →</b>
            </button>
          )}

          {resolution.status === 'done' && !exact && resolution.candidates.length > 0 && (
            <div className="state-counterparty-candidates">
              <p>{item.kind === 'payer'
                ? 'El nombre del organismo no permite asumir una identidad única. Revisa los candidatos antes de abrir una ficha.'
                : 'No se obtuvo una coincidencia exacta por RUT; se muestran candidatos para revisión.'}</p>
              {resolution.candidates.map((candidate) => (
                <button type="button" key={candidate.entity_id} onClick={() => open(candidate)}>
                  <span><strong>{candidate.name}</strong><small>{[candidate.rut, candidate.entity_type, candidate.commune, candidate.region].filter(Boolean).join(' · ')}</small></span>
                  <em>{scoreLabel(candidate) ?? 'Revisar'}</em>
                </button>
              ))}
            </div>
          )}

          {resolution.status === 'done' && resolution.candidates.length === 0 && (
            <div className="state-counterparty-status">La contraparte está documentada en {source}, pero Atlas todavía no tiene una identidad equivalente para abrir en Entidad 360.</div>
          )}
        </section>

        <footer>
          {item.kind === 'payer'
            ? 'La resolución por nombre es deliberadamente conservadora: una similitud textual no se transforma automáticamente en identidad.'
            : 'Cuando el RUT del comprador coincide con una entidad Atlas, la navegación a Entidad 360 es directa.'}
        </footer>
      </aside>
    </div>
  );
}
