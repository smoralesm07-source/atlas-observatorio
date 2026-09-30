import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRpc } from '../lib/rpc';
import { Badge } from './primitives';
import type { AtlasRole } from './Auth';
import '../styles/entity360-status-marks.css';
import '../styles/entity360-state-relation-card.css';

type EntityUafStatus = {
  entity_id?: string;
  rut?: string;
  universe_status?: string;
  is_uaf_registered: boolean;
  is_potential_screening: boolean;
  management_bucket?: string;
  uaf_sector?: string;
  status_basis?: string;
  refreshed_at?: string;
};

type StateMark = {
  code: 'STATE_SUPPLIER' | 'PUBLIC_FUNDS_RECIPIENT';
  label: string;
  active: boolean;
  status: 'PRESENT' | 'ABSENT' | 'UNKNOWN' | string;
  source: string;
  included_in_score: boolean;
};

type StateSupplier = {
  rut?: string;
  amount_12m?: number | string | null;
  order_count_12m?: number | string | null;
  buyer_count?: number | string | null;
  top_buyer_id?: string | null;
  top_buyer_label?: string | null;
  top_buyer_share?: number | string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  source_snapshot_id?: string | null;
};

type PublicFunds = {
  amount_total?: number | string | null;
  amount_12m?: number | string | null;
  amount_36m?: number | string | null;
  transaction_count?: number | string | null;
  payer_count?: number | string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  top_payer_name?: string | null;
  top_payer_amount?: number | string | null;
  source_snapshot_id?: string | null;
};

type PublicFundsYear = {
  period_year: number;
  amount_total?: number | string | null;
  amount_transfer?: number | string | null;
  amount_supplier?: number | string | null;
  payer_count?: number | string | null;
  transaction_count?: number | string | null;
  top_payer_name?: string | null;
};

type PublicFundsPayer = {
  payer_key?: string;
  payer_name?: string | null;
  period_year: number;
  role?: string | null;
  amount?: number | string | null;
  transaction_count?: number | string | null;
  first_seen?: string | null;
  last_seen?: string | null;
};

type PayerDetail = {
  rows?: PublicFundsPayer[];
  count?: number;
  limit?: number;
  offset?: number;
};

type StateRelation = {
  entity_id?: string;
  rut?: string;
  marks?: StateMark[];
  supplier?: StateSupplier | null;
  public_funds?: PublicFunds | null;
  public_funds_years?: PublicFundsYear[];
  source_status?: Record<string, unknown>;
};

const rutKey = (value: string | null | undefined) =>
  String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');

const money = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(amount)}`
    : '—';
};

const compactMoney = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `$${new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 }).format(amount)}`
    : '—';
};

const integer = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n) : '—';
};

const pct = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(n * 100)}%` : '—';
};

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
};

function StateBuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 9.2 12 4l8.5 5.2M5.5 10.5h13M6.5 10.5v6.7m3.7-6.7v6.7m3.6-6.7v6.7m3.7-6.7v6.7M4.5 18.2h15M3.5 20h17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PublicFundsPayerRows({ entityId, enabled }: { entityId: string; enabled: boolean }) {
  const { data, loading, error } = useRpc<PayerDetail>(
    'obs_public_funds_payer_detail',
    { p_entity_id: entityId, p_year: null, p_limit: 20, p_offset: 0 },
    { skip: !enabled },
  );

  if (!enabled) return null;
  if (loading) return <div className="entity360-state-payer-loading">Cargando detalle de pagadores…</div>;
  if (error) return <div className="entity360-state-payer-loading">Detalle de pagadores no disponible.</div>;

  const rows = data?.rows ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="entity360-state-payers">
      <div className="entity360-state-payers-head">
        <strong>Pagadores y períodos</strong>
        <span>20 registros principales · carga bajo demanda</span>
      </div>
      <div className="entity360-state-payers-list">
        {rows.map((row, index) => (
          <div className="entity360-state-payer-row" key={`${row.payer_key ?? row.payer_name}-${row.period_year}-${row.role ?? ''}-${index}`}>
            <span className="entity360-state-payer-year">{row.period_year}</span>
            <div>
              <strong>{row.payer_name || row.payer_key || 'Organismo sin etiqueta'}</strong>
              <small>{row.role || 'Receptor'} · {integer(row.transaction_count)} registros</small>
            </div>
            <b>{money(row.amount)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Estados compactos de Entidad 360. Las marcas regulatorias y la relación con
 * el Estado se leen mediante RPC livianos por entity_id/RUT y nunca fuerzan al
 * expediente principal a reconstruir universos ni consultar libros mayores.
 *
 * La relación con el Estado se presenta en dos niveles: las marcas rápidas de
 * cabecera y una tarjeta prominente que ocupa visualmente el antiguo KPI
 * “Proveedor del Estado”. El detalle pesado de pagadores sigue siendo lazy.
 */
export function Entity360StatusMarks({ entityId, role }: { entityId: string; role: AtlasRole }) {
  const [titleTarget, setTitleTarget] = useState<HTMLElement | null>(null);
  const [stateKpiTarget, setStateKpiTarget] = useState<HTMLElement | null>(null);
  const [timelineTarget, setTimelineTarget] = useState<HTMLElement | null>(null);
  const [lookupKey, setLookupKey] = useState('');
  const [stateOpen, setStateOpen] = useState(false);

  const { data, loading, error } = useRpc<EntityUafStatus>(
    'obs_entity_uaf_status',
    { p_entity_id: lookupKey },
    { skip: !lookupKey },
  );
  const { data: stateRelation } = useRpc<StateRelation>(
    'obs_state_relation_detail',
    { p_entity_id: entityId },
    { skip: !entityId },
  );

  useEffect(() => {
    setTitleTarget(null);
    setStateKpiTarget(null);
    setTimelineTarget(null);
    setLookupKey('');
    setStateOpen(false);

    let previousKpi: HTMLElement | null = null;

    const locate = () => {
      const root = document.querySelector<HTMLElement>('.entity360');
      if (!root) return;

      const title = root.querySelector<HTMLElement>('.entity360-titleline') ?? null;
      setTitleTarget(title);

      const visibleRut = root.querySelector<HTMLElement>('.entity360-meta .mono')?.textContent?.trim() ?? '';
      const nextLookup = visibleRut && !/^sin rut$/i.test(visibleRut) ? visibleRut : entityId;
      setLookupKey(nextLookup);

      const kpis = Array.from(root.querySelectorAll<HTMLElement>('.entity360-kpi'));
      const kpi = kpis.find((node) =>
        node.querySelector<HTMLElement>('.entity360-kpi-copy > span')?.textContent?.trim() === 'Proveedor del Estado'
      ) ?? null;
      if (previousKpi && previousKpi !== kpi) previousKpi.classList.remove('entity360-kpi-state-host');
      if (kpi) kpi.classList.add('entity360-kpi-state-host');
      previousKpi = kpi;
      setStateKpiTarget(kpi);

      const cards = Array.from(root.querySelectorAll<HTMLElement>('.entity360-card'));
      const timelineCard = cards.find((node) =>
        node.querySelector<HTMLElement>('header h2')?.textContent?.trim() === 'Hechos críticos'
      ) ?? null;
      setTimelineTarget(timelineCard?.querySelector<HTMLElement>('.entity360-card-body') ?? null);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (previousKpi) previousKpi.classList.remove('entity360-kpi-state-host');
    };
  }, [entityId]);

  const visibleRutKey = rutKey(lookupKey);
  const returnedRutKey = rutKey(data?.rut);
  const stateRutKey = rutKey(stateRelation?.rut);
  const uafIdentitySafe = !visibleRutKey || !returnedRutKey || visibleRutKey === returnedRutKey;
  const stateIdentitySafe = !visibleRutKey || !stateRutKey || visibleRutKey === stateRutKey;

  const registered = !loading && !error && data && uafIdentitySafe && data.is_uaf_registered === true;
  const potential = Boolean(!registered && !loading && !error && data && uafIdentitySafe && data.is_potential_screening === true);
  const basis = data?.status_basis ?? undefined;
  const potentialTitle = data?.uaf_sector
    ? `Screening de potencial SO · ${data.uaf_sector}. ${basis ?? ''}`.trim()
    : basis;
  const terminated = /término de giro/i.test(titleTarget?.textContent ?? '');
  const manageableQueue = role !== 'viewer'
    ? (potential ? 'potenciales' : registered && terminated ? 'termino' : null)
    : null;
  const navigationRut = data?.rut ?? lookupKey;

  const marks = stateIdentitySafe ? (stateRelation?.marks ?? []) : [];
  const stateSupplierMark = marks.find((mark) => mark.code === 'STATE_SUPPLIER');
  const publicFundsStateMark = marks.find((mark) => mark.code === 'PUBLIC_FUNDS_RECIPIENT');
  const stateSupplier = stateSupplierMark?.status === 'PRESENT' ? stateSupplierMark : undefined;
  const publicFundsMark = publicFundsStateMark?.status === 'PRESENT' ? publicFundsStateMark : undefined;
  const supplier = stateSupplier ? stateRelation?.supplier : null;
  const publicFunds = publicFundsMark ? stateRelation?.public_funds : null;

  const allYears = useMemo(
    () => [...(publicFundsMark ? (stateRelation?.public_funds_years ?? []) : [])]
      .filter((row) => Number.isFinite(Number(row.period_year)))
      .sort((a, b) => b.period_year - a.period_year),
    [publicFundsMark, stateRelation?.public_funds_years],
  );
  const years = allYears.slice(0, 5);
  const criticalYears = allYears.filter((row) => positive(row.amount_transfer)).slice(0, 4);
  const hasStateRelation = Boolean(stateSupplier || publicFundsMark);
  const sourcesComplete = stateSupplierMark?.status === 'ABSENT' && publicFundsStateMark?.status === 'ABSENT';

  const relationValue = stateSupplier && publicFundsMark
    ? '2 vínculos'
    : publicFundsMark
      ? 'Fondos públicos'
      : stateSupplier
        ? 'Proveedor'
        : sourcesComplete
          ? 'No registra'
          : 'Sin evidencia';

  const relationSub = publicFunds
    ? `${compactMoney(publicFunds.amount_total)} · ${integer(publicFunds.payer_count)} organismos`
    : supplier
      ? `${integer(supplier.order_count_12m)} OC · ${integer(supplier.buyer_count)} organismos`
      : 'ChileCompra + Presupuesto Abierto';

  const openStateDetail = () => {
    if (!hasStateRelation) return;
    setStateOpen(true);
    window.setTimeout(() => stateKpiTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 10);
  };

  const headerPortal = titleTarget && lookupKey ? createPortal(
    <>
      {!loading && !error && data && uafIdentitySafe && (
        <Badge tone={registered ? 'present' : 'absent'} title={basis}>
          {registered ? 'SO inscrito' : 'No inscrito'}
        </Badge>
      )}
      {potential && (
        <Badge tone="medium" title={potentialTitle}>
          Potencial SO
        </Badge>
      )}
      {stateSupplier && (
        <Badge tone="present" title="RUT observado como proveedor en el universo ChileCompra. Marca contextual; no integra el IPA.">
          Proveedor del Estado
        </Badge>
      )}
      {publicFundsMark && (
        <Badge tone="present" title="RUT observado como receptor de fondos en Presupuesto Abierto. Marca contextual; no integra el IPA.">
          Fondos públicos
        </Badge>
      )}
      {manageableQueue && (
        <button
          className="entity360-manage-case"
          aria-label="Gestionar entidad en la mesa de casos"
          onClick={() => {
            window.location.hash = `#/universo-so?vista=casos&cola=${manageableQueue}&q=${encodeURIComponent(navigationRut)}`;
          }}
          title={manageableQueue === 'termino' ? 'Abrir este universo en la mesa de casos' : 'Abrir potenciales SO en la mesa de casos'}
        >
          Gestionar
        </button>
      )}
    </>,
    titleTarget,
  ) : null;

  const kpiPortal = stateKpiTarget ? createPortal(
    <>
      <button
        type="button"
        className="entity360-state-kpi-overlay"
        data-active={hasStateRelation}
        disabled={!hasStateRelation}
        aria-expanded={hasStateRelation ? stateOpen : undefined}
        onClick={() => setStateOpen((open) => !open)}
        title={hasStateRelation ? 'Abrir detalle de la relación con el Estado' : 'Sin relaciones observadas en las fuentes disponibles'}
      >
        <span className="entity360-state-kpi-icon"><StateBuildingIcon /></span>
        <span className="entity360-state-kpi-copy">
          <span>Relación con el Estado</span>
          <strong>{relationValue}</strong>
          <small>{relationSub}</small>
        </span>
        {hasStateRelation && (
          <span className="entity360-state-kpi-cta">
            <i />
            <span>Ver detalle</span>
            <b aria-hidden="true">›</b>
          </span>
        )}
      </button>

      {hasStateRelation && stateOpen && (
        <div className="entity360-state-kpi-panel" role="dialog" aria-label="Detalle de la relación con el Estado">
          <header>
            <div>
              <span>Contexto transversal</span>
              <strong>Relación con el Estado</strong>
            </div>
            <div className="entity360-state-panel-actions">
              <small>No integra el IPA</small>
              <button type="button" onClick={() => setStateOpen(false)} aria-label="Cerrar detalle">×</button>
            </div>
          </header>

          {supplier && (
            <section>
              <div className="entity360-state-section-title">
                <strong>Proveedor del Estado</strong>
                <span>ChileCompra</span>
              </div>
              <dl>
                <dt>Monto observado · 12 meses</dt><dd>{money(supplier.amount_12m)}</dd>
                <dt>Órdenes de compra</dt><dd>{integer(supplier.order_count_12m)}</dd>
                <dt>Organismos compradores</dt><dd>{integer(supplier.buyer_count)}</dd>
                <dt>Principal comprador</dt><dd>{supplier.top_buyer_label || supplier.top_buyer_id || '—'}</dd>
                <dt>Participación principal comprador</dt><dd>{pct(supplier.top_buyer_share)}</dd>
                <dt>Período observado</dt><dd>{supplier.first_seen || '—'} → {supplier.last_seen || '—'}</dd>
              </dl>
            </section>
          )}

          {publicFunds && (
            <section>
              <div className="entity360-state-section-title">
                <strong>Fondos públicos recibidos</strong>
                <span>Presupuesto Abierto</span>
              </div>
              <dl>
                <dt>Monto histórico observado</dt><dd>{money(publicFunds.amount_total)}</dd>
                <dt>Últimos 12 meses</dt><dd>{money(publicFunds.amount_12m)}</dd>
                <dt>Organismos pagadores</dt><dd>{integer(publicFunds.payer_count)}</dd>
                <dt>Registros</dt><dd>{integer(publicFunds.transaction_count)}</dd>
                <dt>Principal pagador</dt><dd>{publicFunds.top_payer_name || '—'}</dd>
                <dt>Monto principal pagador</dt><dd>{money(publicFunds.top_payer_amount)}</dd>
              </dl>
              {years.length > 0 && (
                <div className="entity360-state-years">
                  {years.map((row) => (
                    <div key={row.period_year}>
                      <strong>{row.period_year}</strong>
                      <span>{money(positive(row.amount_transfer) ? row.amount_transfer : row.amount_total)}</span>
                      <small>
                        {integer(row.payer_count)} pagadores · {integer(row.transaction_count)} registros
                        {positive(row.amount_supplier) ? ` · compras ${compactMoney(row.amount_supplier)}` : ''}
                      </small>
                    </div>
                  ))}
                </div>
              )}
              <PublicFundsPayerRows entityId={entityId} enabled={stateOpen} />
            </section>
          )}

          <footer>Presencia descriptiva basada en RUT validado. Recibir fondos públicos y ser proveedor son condiciones independientes y no constituyen por sí mismas una señal de riesgo.</footer>
        </div>
      )}
    </>,
    stateKpiTarget,
  ) : null;

  const timelinePortal = timelineTarget && criticalYears.length > 0 ? createPortal(
    <div className="entity360-state-critical-years">
      <div className="entity360-state-critical-head">
        <div>
          <span>Hecho anual contextual</span>
          <strong>Recepción de fondos públicos</strong>
        </div>
        <small>Presupuesto Abierto</small>
      </div>
      <div className="entity360-state-critical-list">
        {criticalYears.slice().reverse().map((row) => (
          <button type="button" key={row.period_year} onClick={openStateDetail} title="Abrir detalle de relación con el Estado">
            <strong>{row.period_year}</strong>
            <span>{compactMoney(row.amount_transfer)}</span>
            <small>{integer(row.payer_count)} organismos · {integer(row.transaction_count)} registros</small>
          </button>
        ))}
      </div>
      <div className="entity360-state-critical-note">Se muestra por año para no atribuir una fecha exacta que la agregación anual no sostiene.</div>
    </div>,
    timelineTarget,
  ) : null;

  return <>{headerPortal}{kpiPortal}{timelinePortal}</>;
}
