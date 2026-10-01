import { useMemo, useState } from 'react';
import type { ProviderHistoryYear } from '../lib/providerHistory';
import '../styles/huella-publica-trends.css';

export type PublicFundsTrendYear = {
  year: number;
  amount_paid?: number | null;
  amount_as_supplier?: number | null;
  amount_as_recipient?: number | null;
  payer_count?: number | null;
  transaction_count?: number | null;
};

type ActivityMode = 'counterparties' | 'transactions';
type Tone = 'market' | 'funds';

type TrendStripProps = {
  label: string;
  tone: Tone;
  years: number[];
  values: Map<number, number>;
  formatter: (value: number) => string;
  emptyLabel: string;
};

const compactMoney = new Intl.NumberFormat('es-CL', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function asNumber(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: number) {
  return `$${compactMoney.format(value)}`;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString('es-CL');
}

function mapValues<T>(rows: T[], year: (row: T) => number, value: (row: T) => number | null | undefined) {
  const map = new Map<number, number>();
  for (const row of rows) map.set(year(row), asNumber(value(row)));
  return map;
}

function TrendStrip({ label, tone, years, values, formatter, emptyLabel }: TrendStripProps) {
  const max = Math.max(0, ...years.map((year) => values.get(year) ?? 0));
  const hasData = max > 0;
  const latest = [...years].reverse().find((year) => (values.get(year) ?? 0) > 0);
  const latestValue = latest == null ? 0 : values.get(latest) ?? 0;

  return (
    <div className="public-trend-strip" data-tone={tone}>
      <div className="public-trend-strip-head">
        <span><i />{label}</span>
        <strong>{hasData ? formatter(latestValue) : '—'}</strong>
      </div>
      {!hasData ? (
        <div className="public-trend-empty">{emptyLabel}</div>
      ) : (
        <div className="public-trend-bars" role="img" aria-label={`${label}: tendencia anual`}>
          {years.map((year) => {
            const value = values.get(year) ?? 0;
            const height = max > 0 ? Math.max(value > 0 ? 7 : 0, (value / max) * 100) : 0;
            return (
              <div className="public-trend-column" key={year} title={`${year}: ${formatter(value)}`}>
                <div className="public-trend-bar-zone"><i style={{ height: `${height}%` }} /></div>
                <small>{String(year).slice(-2)}</small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HuellaPublicaTrends({
  marketYears,
  fundsYears,
  fundsLoading,
}: {
  marketYears: ProviderHistoryYear[];
  fundsYears: PublicFundsTrendYear[];
  fundsLoading?: boolean;
}) {
  const [activityMode, setActivityMode] = useState<ActivityMode>('counterparties');

  const years = useMemo(() => {
    const found = new Set<number>();
    for (const row of marketYears) found.add(Number(row.year));
    for (const row of fundsYears) found.add(Number(row.year));
    return [...found].filter(Number.isFinite).sort((a, b) => a - b);
  }, [marketYears, fundsYears]);

  const marketAmount = useMemo(
    () => mapValues(marketYears, (row) => row.year, (row) => row.amount_clp),
    [marketYears],
  );
  const fundsAmount = useMemo(
    () => mapValues(fundsYears, (row) => row.year, (row) => row.amount_paid),
    [fundsYears],
  );
  const marketActivity = useMemo(
    () => mapValues(
      marketYears,
      (row) => row.year,
      (row) => activityMode === 'counterparties' ? row.buyer_count : row.order_count,
    ),
    [activityMode, marketYears],
  );
  const fundsActivity = useMemo(
    () => mapValues(
      fundsYears,
      (row) => row.year,
      (row) => activityMode === 'counterparties' ? row.payer_count : row.transaction_count,
    ),
    [activityMode, fundsYears],
  );

  if (years.length === 0 && !fundsLoading) return null;

  return (
    <section className="public-trends" aria-label="Tendencias de huella pública">
      <div className="public-trends-title">
        <div>
          <span>Evolución temporal</span>
          <strong>Tendencias de la huella pública</strong>
        </div>
        <small>Series anuales preagregadas · sin sumar ambas fuentes</small>
      </div>

      <div className="public-trends-grid">
        <article className="public-trend-card">
          <header>
            <div><span>Montos observados</span><strong>Flujo anual</strong></div>
            <small>CLP</small>
          </header>
          <TrendStrip
            label="Mercado Público · órdenes de compra"
            tone="market"
            years={years}
            values={marketAmount}
            formatter={formatMoney}
            emptyLabel="Sin monto histórico de compras en el período."
          />
          <TrendStrip
            label="Presupuesto Abierto · pagos"
            tone="funds"
            years={years}
            values={fundsAmount}
            formatter={formatMoney}
            emptyLabel={fundsLoading ? 'Cargando pagos anuales…' : 'Sin pagos observados en el período.'}
          />
          <p>Las órdenes de compra y los pagos presupuestarios representan hechos distintos; se muestran en paralelo y no se suman.</p>
        </article>

        <article className="public-trend-card">
          <header className="public-activity-head">
            <div><span>Actividad observada</span><strong>{activityMode === 'counterparties' ? 'Contrapartes por año' : 'Operaciones por año'}</strong></div>
            <div className="public-trend-toggle" aria-label="Métrica de actividad">
              <button type="button" data-active={activityMode === 'counterparties'} onClick={() => setActivityMode('counterparties')}>Contrapartes</button>
              <button type="button" data-active={activityMode === 'transactions'} onClick={() => setActivityMode('transactions')}>Operaciones</button>
            </div>
          </header>
          <TrendStrip
            label={activityMode === 'counterparties' ? 'Mercado Público · compradores' : 'Mercado Público · OC'}
            tone="market"
            years={years}
            values={marketActivity}
            formatter={formatCount}
            emptyLabel="Sin actividad histórica de Mercado Público."
          />
          <TrendStrip
            label={activityMode === 'counterparties' ? 'Presupuesto Abierto · pagadores' : 'Presupuesto Abierto · transacciones'}
            tone="funds"
            years={years}
            values={fundsActivity}
            formatter={formatCount}
            emptyLabel={fundsLoading ? 'Cargando actividad anual…' : 'Sin actividad de Presupuesto Abierto.'}
          />
          <p>El selector cambia sólo la lectura del segundo gráfico; no dispara nuevas consultas.</p>
        </article>
      </div>
    </section>
  );
}
