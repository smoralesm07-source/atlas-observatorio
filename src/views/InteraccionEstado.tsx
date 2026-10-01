import { FormEvent, useMemo, useState } from 'react';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { useRpc } from '../lib/rpc';
import { n, rutFormat, titleCase } from '../lib/format';

type MpSearchRow = {
  rut: string; label: string | null; first_seen: string | null; last_seen: string | null;
  amount_clp: number | null; order_count: number | null; active_years: number | null;
};
type PaSearchRow = {
  rut: string; label: string | null; entity_id: string | null; amount_paid: number | null;
  transaction_count: number | null; payer_count: number | null; first_seen: string | null;
  last_seen: string | null; top_payer_name: string | null; top_payer_amount: number | null;
};
type SearchResponse<T> = { ok: boolean; rows: T[]; error?: string };

type MpSummary = {
  rut: string; label: string | null; is_state_supplier: boolean; first_year: number; last_year: number;
  first_seen: string | null; last_seen: string | null; amount_clp: number; order_count: number;
  buyer_count: number; active_months: number; active_years: number; top_buyer_id: string | null;
  top_buyer_label: string | null; top_buyer_amount_clp: number | null; top_buyer_order_count: number | null;
};
type MpSummaryResponse = { ok: boolean; history_ready: boolean; supplier: MpSummary | null };
type MpBuyer = {
  buyer_id: string; buyer_label: string | null; amount_clp: number; order_count: number;
  first_year: number; last_year: number; active_years: number;
};
type MpTimeline = {
  year: number; amount_clp: number; order_count: number; buyer_count: number;
  active_months: number; first_seen: string | null; last_seen: string | null;
};

type PaSummary = {
  rut: string; entity_id: string | null; label: string | null; has_public_payments: boolean;
  first_year: number; last_year: number; first_seen: string | null; last_seen: string | null;
  amount_paid: number; amount_as_supplier: number; amount_as_recipient: number;
  transaction_count: number; payer_count: number; top_payer_key: string | null;
  top_payer_name: string | null; top_payer_amount: number | null;
};
type PaSummaryResponse = { ok: boolean; summary: PaSummary | null; amount_basis: string };
type PaPayer = {
  payer_key: string; payer_name: string | null; amount_paid: number; transaction_count: number;
  first_year: number; last_year: number; first_seen: string | null; last_seen: string | null;
  supplier_role: boolean; recipient_role: boolean;
};
type PaTimeline = {
  year: number; amount_paid: number; amount_as_supplier: number; amount_as_recipient: number;
  payer_count: number; transaction_count: number; top_payer_name: string | null; top_payer_amount: number | null;
};
type RowsResponse<T> = { ok: boolean; rows: T[] };

type UnifiedSearch = {
  rut: string; label: string | null; mercado: MpSearchRow | null; presupuesto: PaSearchRow | null;
};

type PeriodPreset = '2020' | '5y' | 'all';

const currentYear = new Date().getFullYear();
const clpFmt = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const clp = (v: number | null | undefined) => v == null ? '—' : clpFmt.format(v);
const cleanRut = (v: string | null | undefined) => (v ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

function periodBounds(preset: PeriodPreset) {
  if (preset === 'all') return { from: 2007, to: currentYear };
  if (preset === '5y') return { from: Math.max(2007, currentYear - 4), to: currentYear };
  return { from: 2020, to: currentYear };
}

function StateStat({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div style={{ minWidth: 0, padding: '14px 15px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }}>
      <div style={{ color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.045em', marginBottom: 7 }}>{label}</div>
      <div className="num" style={{ color: 'var(--ink-1)', fontSize: 19, fontWeight: 650, lineHeight: 1.15 }}>{value}</div>
      {foot && <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 5 }}>{foot}</div>}
    </div>
  );
}

function PeriodSelector({ value, onChange }: { value: PeriodPreset; onChange: (v: PeriodPreset) => void }) {
  const items: { value: PeriodPreset; label: string }[] = [
    { value: '2020', label: '2020–actualidad' },
    { value: '5y', label: 'Últimos 5 años' },
    { value: 'all', label: 'Toda la historia' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className="btn"
          onClick={() => onChange(item.value)}
          style={{ padding: '7px 10px', opacity: value === item.value ? 1 : .68, fontWeight: value === item.value ? 650 : 500 }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function InteraccionEstado() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selectedRut, setSelectedRut] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodPreset>('2020');
  const bounds = periodBounds(period);
  const searchActive = query.trim().length >= 2 && !selectedRut;

  const mpSearch = useRpc<SearchResponse<MpSearchRow>>('obs_state_interaction_entity', {
    p_action: 'search', p_query: query, p_rut: null, p_from_year: bounds.from, p_to_year: bounds.to, p_limit: 30, p_offset: 0,
  }, { skip: !searchActive });
  const paSearch = useRpc<SearchResponse<PaSearchRow>>('obs_state_public_funds_entity', {
    p_action: 'search', p_query: query, p_rut: null, p_from_year: bounds.from, p_to_year: bounds.to, p_limit: 30, p_offset: 0,
  }, { skip: !searchActive });

  const searchRows = useMemo<UnifiedSearch[]>(() => {
    const map = new Map<string, UnifiedSearch>();
    for (const row of mpSearch.data?.rows ?? []) {
      const key = cleanRut(row.rut);
      map.set(key, { rut: row.rut, label: row.label, mercado: row, presupuesto: null });
    }
    for (const row of paSearch.data?.rows ?? []) {
      const key = cleanRut(row.rut);
      const previous = map.get(key);
      map.set(key, {
        rut: previous?.rut ?? row.rut,
        label: previous?.label ?? row.label,
        mercado: previous?.mercado ?? null,
        presupuesto: row,
      });
    }
    return [...map.values()].sort((a, b) => {
      const bothA = Number(Boolean(a.mercado)) + Number(Boolean(a.presupuesto));
      const bothB = Number(Boolean(b.mercado)) + Number(Boolean(b.presupuesto));
      if (bothA !== bothB) return bothB - bothA;
      const amountA = (a.mercado?.amount_clp ?? 0) + (a.presupuesto?.amount_paid ?? 0);
      const amountB = (b.mercado?.amount_clp ?? 0) + (b.presupuesto?.amount_paid ?? 0);
      return amountB - amountA;
    });
  }, [mpSearch.data, paSearch.data]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (q.length < 2) return;
    setSelectedRut(null);
    setSelectedLabel(null);
    setQuery(q);
  }

  function choose(row: UnifiedSearch) {
    setSelectedRut(row.rut);
    setSelectedLabel(row.label);
  }

  function reset() {
    setSelectedRut(null);
    setSelectedLabel(null);
    setQuery('');
    setDraft('');
  }

  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Interacción con el Estado</h1>
        <p className="view-lede">
          Consulta por entidad para reconstruir su relación económica observada con organismos públicos. Mercado Público responde
          qué organismos le compran y Presupuesto Abierto muestra pagos efectivos registrados. Son fuentes y universos distintos;
          sus montos se presentan separados y no se suman.
        </p>
      </header>

      <Panel>
        <form onSubmit={submit} style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Buscar por RUT o nombre de entidad"
            aria-label="Buscar entidad en Mercado Público y Presupuesto Abierto"
            style={{ flex: 1, minWidth: 0, height: 42, border: '1px solid var(--line)', borderRadius: 8, padding: '0 13px', background: 'var(--surface)', color: 'var(--ink-1)', fontSize: 14 }}
          />
          <button className="btn" type="submit" style={{ height: 42, paddingInline: 16 }}>Buscar</button>
          {(query || selectedRut) && <button className="btn" type="button" onClick={reset} style={{ height: 42 }}>Limpiar</button>}
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <PeriodSelector value={period} onChange={setPeriod} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Período de análisis: {period === 'all' ? 'historia disponible por fuente' : `${bounds.from}–${bounds.to}`}
          </span>
        </div>
      </Panel>

      {!selectedRut && query && (
        <SearchResults
          query={query}
          rows={searchRows}
          loading={mpSearch.loading || paSearch.loading}
          mpError={mpSearch.error}
          paError={paSearch.error}
          onPick={choose}
        />
      )}

      {selectedRut && (
        <EntityStateProfile
          rut={selectedRut}
          label={selectedLabel}
          fromYear={bounds.from}
          toYear={bounds.to}
          allHistory={period === 'all'}
          onBack={() => setSelectedRut(null)}
        />
      )}

      {!selectedRut && !query && (
        <div style={{ marginTop: 16 }}>
          <Semantics>
            La búsqueda no usa puntuaciones de riesgo ni prioridades del antiguo monitor. Una entidad aparece por la existencia de una relación observada en Mercado Público o de pagos efectivos en Presupuesto Abierto.
          </Semantics>
        </div>
      )}
    </div>
  );
}

function SearchResults({ query, rows, loading, mpError, paError, onPick }: {
  query: string; rows: UnifiedSearch[]; loading: boolean; mpError: string | null; paError: string | null;
  onPick: (row: UnifiedSearch) => void;
}) {
  if (loading && rows.length === 0) return <Loading label="Buscando en ambas fuentes…" />;
  if (rows.length === 0 && mpError && paError) return <ErrorBox error="No fue posible consultar Mercado Público ni Presupuesto Abierto." />;
  if (rows.length === 0) return <Empty title={`Sin coincidencias para “${query}”`} hint="Prueba con el RUT completo o una parte distintiva de la razón social." />;
  return (
    <Panel title="Entidades encontradas" meta={`${n(rows.length)} coincidencias`}>
      {(mpError || paError) && (
        <div className="note" style={{ marginBottom: 10 }}>
          Resultado parcial: {mpError ? 'Mercado Público no respondió. ' : ''}{paError ? 'Presupuesto Abierto no respondió.' : ''}
        </div>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <button
            key={cleanRut(row.rut)}
            type="button"
            onClick={() => onPick(row)}
            style={{ width: '100%', textAlign: 'left', border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '12px 13px', cursor: 'pointer', color: 'inherit' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink-1)', fontWeight: 650 }}>{row.label ? titleCase(row.label) : rutFormat(row.rut)}</div>
                <div className="num" style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 3 }}>{rutFormat(row.rut)}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {row.mercado && <Badge tone="present">Proveedor del Estado</Badge>}
                {row.presupuesto && <Badge tone="present">Pagos públicos observados</Badge>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function EntityStateProfile({ rut, label, fromYear, toYear, allHistory, onBack }: {
  rut: string; label: string | null; fromYear: number; toYear: number; allHistory: boolean; onBack: () => void;
}) {
  const mpSummary = useRpc<MpSummaryResponse>('obs_state_interaction_entity', {
    p_action: 'summary', p_rut: rut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  });
  const paSummary = useRpc<PaSummaryResponse>('obs_state_public_funds_entity', {
    p_action: 'summary', p_rut: rut, p_query: null, p_from_year: Math.max(2016, fromYear), p_to_year: toYear, p_limit: 100, p_offset: 0,
  });
  const mpBuyers = useRpc<RowsResponse<MpBuyer>>('obs_state_interaction_entity', {
    p_action: 'buyers', p_rut: rut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  });
  const paPayers = useRpc<RowsResponse<PaPayer>>('obs_state_public_funds_entity', {
    p_action: 'payers', p_rut: rut, p_query: null, p_from_year: Math.max(2016, fromYear), p_to_year: toYear, p_limit: 100, p_offset: 0,
  });
  const mpTimeline = useRpc<RowsResponse<MpTimeline>>('obs_state_interaction_entity', {
    p_action: 'timeline', p_rut: rut, p_query: null, p_from_year: fromYear, p_to_year: toYear, p_limit: 100, p_offset: 0,
  });
  const paTimeline = useRpc<RowsResponse<PaTimeline>>('obs_state_public_funds_entity', {
    p_action: 'timeline', p_rut: rut, p_query: null, p_from_year: Math.max(2016, fromYear), p_to_year: toYear, p_limit: 100, p_offset: 0,
  });

  const mp = mpSummary.data?.supplier ?? null;
  const pa = paSummary.data?.summary ?? null;
  const displayName = label || mp?.label || pa?.label || rutFormat(rut);

  const years = useMemo(() => {
    const m = new Map<number, { mp?: MpTimeline; pa?: PaTimeline }>();
    for (const row of mpTimeline.data?.rows ?? []) m.set(row.year, { ...(m.get(row.year) ?? {}), mp: row });
    for (const row of paTimeline.data?.rows ?? []) m.set(row.year, { ...(m.get(row.year) ?? {}), pa: row });
    return [...m.entries()].sort(([a], [b]) => b - a);
  }, [mpTimeline.data, paTimeline.data]);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <button className="btn" type="button" onClick={onBack} style={{ marginBottom: 10 }}>← Resultados</button>
          <h2 style={{ margin: 0, color: 'var(--ink-1)', fontSize: 23 }}>{titleCase(displayName)}</h2>
          <div className="num" style={{ color: 'var(--ink-3)', marginTop: 4 }}>{rutFormat(rut)}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {mpSummary.loading ? <Badge tone="unknown">Consultando compras</Badge> : <Badge tone={mp ? 'present' : 'absent'}>{mp ? 'Proveedor del Estado' : 'Sin compras observadas'}</Badge>}
          {paSummary.loading ? <Badge tone="unknown">Consultando pagos</Badge> : <Badge tone={pa ? 'present' : 'absent'}>{pa ? 'Con pagos públicos' : 'Sin pagos observados'}</Badge>}
        </div>
      </div>

      {(mpSummary.error || paSummary.error) && (
        <div className="note" style={{ marginBottom: 12 }}>
          La ficha puede estar incompleta: {mpSummary.error ? `Mercado Público: ${mpSummary.error}. ` : ''}{paSummary.error ? `Presupuesto Abierto: ${paSummary.error}.` : ''}
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 14, alignItems: 'stretch' }}>
        <Panel title="Compras públicas" meta="Mercado Público · ventas observadas al Estado">
          {mpSummary.loading ? <Loading label="Leyendo resumen de compras…" /> : mp ? (
            <>
              <div className="grid grid-2" style={{ gap: 9 }}>
                <StateStat label="Monto en OC" value={clp(mp.amount_clp)} foot={`${n(mp.order_count)} órdenes`} />
                <StateStat label="Organismos compradores" value={n(mp.buyer_count)} foot={`${mp.first_year}–${mp.last_year}`} />
                <StateStat label="Principal comprador" value={mp.top_buyer_label ? titleCase(mp.top_buyer_label) : (mp.top_buyer_id ?? '—')} foot={clp(mp.top_buyer_amount_clp)} />
                <StateStat label="Años activos" value={n(mp.active_years)} foot={`${n(mp.active_months)} meses activos`} />
              </div>
              <Semantics>Los montos corresponden a órdenes de compra observadas; no equivalen a pagos efectivos ni a ventas privadas totales.</Semantics>
            </>
          ) : <Empty title="Sin compras públicas observadas en el período" />}
        </Panel>

        <Panel title="Recursos públicos recibidos" meta="Presupuesto Abierto · pagos efectivos">
          {paSummary.loading ? <Loading label="Leyendo pagos públicos…" /> : pa ? (
            <>
              <div className="grid grid-2" style={{ gap: 9 }}>
                <StateStat label="Pagado observado" value={clp(pa.amount_paid)} foot={`${n(pa.transaction_count)} registros agregados`} />
                <StateStat label="Organismos pagadores" value={n(pa.payer_count)} foot={`${pa.first_year}–${pa.last_year}`} />
                <StateStat label="Como proveedor" value={clp(pa.amount_as_supplier)} foot="rol proveedor en la fuente" />
                <StateStat label="Como receptor" value={clp(pa.amount_as_recipient)} foot="otros beneficiarios/receptores" />
              </div>
              <Semantics>Presupuesto Abierto se materializa sólo con <strong>monto_pago positivo</strong>, RUT resuelto y exclusión de relaciones intra-Estado.</Semantics>
            </>
          ) : <Empty title="Sin pagos efectivos observados en el período" />}
        </Panel>
      </div>

      <div className="grid grid-2" style={{ gap: 14, marginTop: 14, alignItems: 'start' }}>
        <Panel title="A quién le ha vendido" meta="Mercado Público · por organismo">
          {mpBuyers.loading ? <Loading label="Cargando compradores…" /> : mpBuyers.error ? <ErrorBox error={mpBuyers.error} onRetry={mpBuyers.reload} /> : (
            <RelationshipTable
              rows={(mpBuyers.data?.rows ?? []).map((r) => ({
                key: r.buyer_id, name: r.buyer_label || r.buyer_id, amount: r.amount_clp,
                count: r.order_count, period: `${r.first_year}–${r.last_year}`,
              }))}
              countLabel="OC"
              empty="Sin compradores en el período"
            />
          )}
        </Panel>

        <Panel title="Quién le ha pagado" meta="Presupuesto Abierto · por organismo">
          {paPayers.loading ? <Loading label="Cargando pagadores…" /> : paPayers.error ? <ErrorBox error={paPayers.error} onRetry={paPayers.reload} /> : (
            <RelationshipTable
              rows={(paPayers.data?.rows ?? []).map((r) => ({
                key: r.payer_key, name: r.payer_name || r.payer_key, amount: r.amount_paid,
                count: r.transaction_count, period: `${r.first_year}–${r.last_year}`,
                role: r.supplier_role && r.recipient_role ? 'Proveedor + receptor' : r.supplier_role ? 'Proveedor' : 'Receptor',
              }))}
              countLabel="registros"
              empty="Sin pagadores en el período"
            />
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel title="Evolución anual" meta={allHistory ? 'Historia disponible por fuente' : `${fromYear}–${toYear}`}>
          {(mpTimeline.loading || paTimeline.loading) && years.length === 0 ? <Loading label="Construyendo evolución…" /> : years.length === 0 ? (
            <Empty title="Sin evolución disponible para este período" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: 780 }}>
                <thead><tr><th>Año</th><th>Mercado Público · monto OC</th><th>OC</th><th>Compradores</th><th>Presupuesto Abierto · pagado</th><th>Como proveedor</th><th>Como receptor</th><th>Pagadores</th></tr></thead>
                <tbody>
                  {years.map(([year, row]) => (
                    <tr key={year}>
                      <td className="num">{year}</td>
                      <td className="num">{clp(row.mp?.amount_clp)}</td>
                      <td className="num">{n(row.mp?.order_count)}</td>
                      <td className="num">{n(row.mp?.buyer_count)}</td>
                      <td className="num">{clp(row.pa?.amount_paid)}</td>
                      <td className="num">{clp(row.pa?.amount_as_supplier)}</td>
                      <td className="num">{clp(row.pa?.amount_as_recipient)}</td>
                      <td className="num">{n(row.pa?.payer_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Semantics>Las columnas de Mercado Público y Presupuesto Abierto se comparan temporalmente, pero no se suman: una orden de compra y un pago presupuestario representan hechos distintos.</Semantics>
        </Panel>
      </div>
    </div>
  );
}

function RelationshipTable({ rows, countLabel, empty }: {
  rows: { key: string; name: string; amount: number; count: number; period: string; role?: string }[];
  countLabel: string; empty: string;
}) {
  if (rows.length === 0) return <Empty title={empty} />;
  return (
    <div style={{ overflowX: 'auto', maxHeight: 440 }}>
      <table className="table" style={{ minWidth: 600 }}>
        <thead><tr><th>Organismo</th><th>Monto</th><th>{countLabel}</th><th>Período</th><th>Rol</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{titleCase(r.name)}</td>
              <td className="num">{clp(r.amount)}</td>
              <td className="num">{n(r.count)}</td>
              <td className="num">{r.period}</td>
              <td>{r.role ?? 'Proveedor'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
