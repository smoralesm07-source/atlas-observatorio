import { useMemo, useState } from 'react';
import type { ProviderHistoryYear } from '../lib/providerHistory';
import '../styles/huella-publica-flow-chart.css';

export type PublicFundsTrendYear = {
  year: number;
  amount_paid?: number | null;
  amount_as_supplier?: number | null;
  amount_as_recipient?: number | null;
  payer_count?: number | null;
  transaction_count?: number | null;
};

type SourceMode = 'MARKET' | 'FUNDS';

type ChartRow = {
  year: number;
  amount: number;
  activity: number;
};

const moneyCompact = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 });
const numberCompact = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 });

function amountLabel(value: number) {
  return `$${moneyCompact.format(value)}`;
}

function asNumber(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function HuellaPublicaFlowChart({
  marketYears,
  fundsYears,
  fundsLoading,
}: {
  marketYears: ProviderHistoryYear[];
  fundsYears: PublicFundsTrendYear[];
  fundsLoading?: boolean;
}) {
  const hasMarket = marketYears.some((row) => asNumber(row.amount_clp) > 0 || asNumber(row.order_count) > 0);
  const hasFunds = fundsYears.some((row) => asNumber(row.amount_paid) > 0 || asNumber(row.transaction_count) > 0);
  const [source, setSource] = useState<SourceMode>(() => hasMarket ? 'MARKET' : 'FUNDS');

  const activeSource = source === 'MARKET' && !hasMarket && hasFunds
    ? 'FUNDS'
    : source === 'FUNDS' && !hasFunds && hasMarket
      ? 'MARKET'
      : source;

  const rows = useMemo<ChartRow[]>(() => {
    const years = new Set<number>();
    marketYears.forEach((row) => years.add(Number(row.year)));
    fundsYears.forEach((row) => years.add(Number(row.year)));

    const market = new Map(marketYears.map((row) => [Number(row.year), row]));
    const funds = new Map(fundsYears.map((row) => [Number(row.year), row]));

    return [...years]
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .map((year) => activeSource === 'MARKET'
        ? { year, amount: asNumber(market.get(year)?.amount_clp), activity: asNumber(market.get(year)?.order_count) }
        : { year, amount: asNumber(funds.get(year)?.amount_paid), activity: asNumber(funds.get(year)?.transaction_count) });
  }, [activeSource, fundsYears, marketYears]);

  const maxAmount = Math.max(0, ...rows.map((row) => row.amount));
  const maxActivity = Math.max(0, ...rows.map((row) => row.activity));
  const hasData = maxAmount > 0 || maxActivity > 0;

  const width = 760;
  const height = 250;
  const left = 58;
  const right = 28;
  const top = 26;
  const bottom = 38;
  const chartW = width - left - right;
  const chartH = height - top - bottom;
  const step = rows.length > 0 ? chartW / rows.length : chartW;
  const barW = Math.min(48, Math.max(20, step * 0.48));

  const points = rows.map((row, index) => {
    const x = left + step * index + step / 2;
    const y = top + chartH - (maxActivity > 0 ? (row.activity / maxActivity) * chartH * 0.92 : 0);
    return { x, y, row };
  });
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');

  const latest = [...rows].reverse().find((row) => row.amount > 0 || row.activity > 0);

  return (
    <section className="state-flow-chart" aria-label="Evolución de la relación con el Estado">
      <header className="state-flow-chart-head">
        <div>
          <span>Relación con el Estado</span>
          <h3>{activeSource === 'MARKET' ? 'Evolución de compras públicas' : 'Evolución de pagos públicos'}</h3>
          <small>{activeSource === 'MARKET' ? 'Mercado Público · monto y órdenes de compra' : 'Presupuesto Abierto · monto y registros de pago'}</small>
        </div>
        {hasMarket && hasFunds && (
          <div className="state-flow-source-toggle" aria-label="Fuente del gráfico">
            <button type="button" data-active={activeSource === 'MARKET'} onClick={() => setSource('MARKET')}>Mercado Público</button>
            <button type="button" data-active={activeSource === 'FUNDS'} onClick={() => setSource('FUNDS')}>Presupuesto Abierto</button>
          </div>
        )}
      </header>

      {!hasData ? (
        <div className="state-flow-empty">{fundsLoading ? 'Cargando evolución anual…' : 'No hay serie anual disponible para la fuente seleccionada.'}</div>
      ) : (
        <>
          <div className="state-flow-svg-wrap">
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico anual de montos y actividad">
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = top + chartH - chartH * ratio;
                return <g key={ratio}>
                  <line x1={left} x2={width - right} y1={y} y2={y} className="state-flow-gridline" />
                  <text x={left - 10} y={y + 4} textAnchor="end" className="state-flow-axis-label">{amountLabel(maxAmount * ratio)}</text>
                </g>;
              })}

              {rows.map((row, index) => {
                const x = left + step * index + step / 2 - barW / 2;
                const barHeight = maxAmount > 0 ? Math.max(row.amount > 0 ? 3 : 0, (row.amount / maxAmount) * chartH * 0.9) : 0;
                const y = top + chartH - barHeight;
                return <g key={row.year}>
                  <rect x={x} y={y} width={barW} height={barHeight} rx="5" className="state-flow-bar">
                    <title>{`${row.year}: ${amountLabel(row.amount)}`}</title>
                  </rect>
                  <text x={x + barW / 2} y={height - 14} textAnchor="middle" className="state-flow-year">{row.year}</text>
                </g>;
              })}

              {maxActivity > 0 && <>
                <path d={linePath} className="state-flow-line" />
                {points.map(({ x, y, row }) => <circle key={`p-${row.year}`} cx={x} cy={y} r="4" className="state-flow-point"><title>{`${row.year}: ${numberCompact.format(row.activity)} operaciones`}</title></circle>)}
              </>}
            </svg>
          </div>
          <footer className="state-flow-legend">
            <span><i data-kind="amount" />Monto observado</span>
            <span><i data-kind="activity" />{activeSource === 'MARKET' ? 'N° de órdenes de compra' : 'N° de pagos'}</span>
            {latest && <strong>Último año con actividad: {latest.year}</strong>}
          </footer>
        </>
      )}
    </section>
  );
}
