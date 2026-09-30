import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRpc } from '../lib/rpc';
import { Badge } from './primitives';
import type { AtlasRole } from './Auth';
import '../styles/entity360-status-marks.css';

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

const integer = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n) : '—';
};

const pct = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(n * 100)}%` : '—';
};

/**
 * Estados compactos de Entidad 360. Las marcas regulatorias y la relación con
 * el Estado se leen mediante RPC livianos por entity_id/RUT y nunca fuerzan al
 * expediente principal a reconstruir universos ni consultar libros mayores.
 */
export function Entity360StatusMarks({ entityId, role }: { entityId: string; role: AtlasRole }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [lookupKey, setLookupKey] = useState('');
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
    setTarget(null);
    setLookupKey('');

    const locate = () => {
      const root = document.querySelector<HTMLElement>('.entity360');
      const node = root?.querySelector<HTMLElement>('.entity360-titleline') ?? null;
      if (!root || !node) return false;

      const visibleRut = root.querySelector<HTMLElement>('.entity360-meta .mono')?.textContent?.trim() ?? '';
      const nextLookup = visibleRut && !/^sin rut$/i.test(visibleRut) ? visibleRut : entityId;
      setLookupKey(nextLookup);
      setTarget(node);
      return true;
    };

    if (locate()) return;

    const observer = new MutationObserver(() => {
      if (locate()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [entityId]);

  if (!target || !lookupKey) return null;

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
  const terminated = /término de giro/i.test(target.textContent ?? '');
  const manageableQueue = role !== 'viewer'
    ? (potential ? 'potenciales' : registered && terminated ? 'termino' : null)
    : null;
  const navigationRut = data?.rut ?? lookupKey;

  const marks = stateIdentitySafe ? (stateRelation?.marks ?? []) : [];
  const stateSupplier = marks.find((mark) => mark.code === 'STATE_SUPPLIER' && mark.status === 'PRESENT');
  const publicFundsMark = marks.find((mark) => mark.code === 'PUBLIC_FUNDS_RECIPIENT' && mark.status === 'PRESENT');
  const supplier = stateSupplier ? stateRelation?.supplier : null;
  const publicFunds = publicFundsMark ? stateRelation?.public_funds : null;
  const years = publicFundsMark ? (stateRelation?.public_funds_years ?? []).slice(0, 5) : [];
  const hasStateRelation = Boolean(stateSupplier || publicFundsMark);

  return createPortal(
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
      {hasStateRelation && (
        <details className="entity360-state-relation">
          <summary>Relación Estado</summary>
          <div className="entity360-state-relation-popover" role="note">
            <header>
              <div>
                <span>Contexto transversal</span>
                <strong>Relación con el Estado</strong>
              </div>
              <small>No integra el IPA</small>
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
                  <strong>Fondos públicos</strong>
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
                        <span>{money(row.amount_total)}</span>
                        <small>{integer(row.payer_count)} pagadores · {integer(row.transaction_count)} registros</small>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <footer>Presencia descriptiva basada en RUT validado. Recibir fondos públicos y ser proveedor son condiciones independientes.</footer>
          </div>
        </details>
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
    target,
  );
}
