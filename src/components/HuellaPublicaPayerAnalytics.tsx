import { useMemo } from 'react';
import '../styles/huella-publica-payer-analytics.css';

type PayerRow = {
  payer_name?: string | null;
  payer_key?: string | null;
  amount_paid?: number | null;
  transaction_count?: number | null;
  source_kind?: string | null;
  payment_proof?: boolean | null;
};

type Slice = {
  label: string;
  value: number;
  share: number;
  tone: number;
  isRest?: boolean;
};

const compactMoney = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 });

function money(value: number) {
  return `$${compactMoney.format(value)}`;
}

function pct(value: number) {
  return `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

export function HuellaPublicaPayerAnalytics({ rows, onOpenOthers }: { rows: PayerRow[]; onOpenOthers?: () => void }) {
  const model = useMemo(() => {
    // Esta analítica conserva una única base semántica: pagos efectivos observados.
    // Las relaciones MUNICIPAL_DTE se muestran en el universo de huella pública,
    // pero no se mezclan con pagos ni con sus métricas de concentración.
    const normalized = rows
      .filter((row) => row.source_kind !== 'MUNICIPAL_DTE' && row.payment_proof !== false)
      .map((row) => ({
        label: String(row.payer_name || row.payer_key || 'Pagador s/d'),
        value: Number(row.amount_paid || 0),
        count: Number(row.transaction_count || 0),
      }))
      .filter((row) => Number.isFinite(row.value) && row.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = normalized.reduce((sum, row) => sum + row.value, 0);
    const topFive = normalized.slice(0, 5);
    const rest = normalized.slice(5).reduce((sum, row) => sum + row.value, 0);
    const slices: Slice[] = topFive.map((row, index) => ({
      label: row.label,
      value: row.value,
      share: total > 0 ? (row.value / total) * 100 : 0,
      tone: index + 1,
    }));
    if (rest > 0) slices.push({ label: 'Otros pagadores', value: rest, share: (rest / total) * 100, tone: 6, isRest: true });

    const top1Share = total > 0 ? ((normalized[0]?.value || 0) / total) * 100 : 0;
    const top3Value = normalized.slice(0, 3).reduce((sum, row) => sum + row.value, 0);
    const top3Share = total > 0 ? (top3Value / total) * 100 : 0;
    const transactionCount = normalized.reduce((sum, row) => sum + row.count, 0);

    let cursor = 0;
    const gradient = slices.map((slice) => {
      const start = cursor;
      cursor += slice.share;
      return `var(--payer-tone-${slice.tone}) ${start}% ${cursor}%`;
    }).join(', ');

    return { normalized, slices, total, top1Share, top3Share, transactionCount, gradient };
  }, [rows]);

  return (
    <section className="payer-analytics" aria-label="Analítica de principales pagadores">
      <header className="payer-analytics-head">
        <div>
          <span>Distribución de pagos</span>
          <h3>Principales pagadores</h3>
          <small>Participación sólo sobre pagos observados; DTE municipales se excluyen de esta analítica.</small>
        </div>
        {model.normalized.length > 0 && <strong>{model.normalized.length.toLocaleString('es-CL')} pagadores</strong>}
      </header>

      {model.normalized.length === 0 ? (
        <div className="payer-analytics-empty">Sin pagos efectivos identificados para el período seleccionado. La huella DTE municipal, si existe, se muestra separadamente arriba.</div>
      ) : (
        <div className="payer-analytics-body">
          <div className="payer-donut-zone">
            <div className="payer-donut" style={{ background: `conic-gradient(${model.gradient})` }}>
              <div><strong>{money(model.total)}</strong><small>Total pagado</small></div>
            </div>
            <div className="payer-legend">
              {model.slices.map((slice) => slice.isRest && onOpenOthers ? (
                <button type="button" className="payer-legend-row payer-legend-action" key={`${slice.label}-${slice.tone}`} onClick={onOpenOthers} title="Explorar pagadores de menor monto">
                  <i data-tone={slice.tone} />
                  <span title={slice.label}>{slice.label}</span>
                  <b>{pct(slice.share)}</b>
                  <em aria-hidden="true">›</em>
                </button>
              ) : (
                <div className="payer-legend-row" key={`${slice.label}-${slice.tone}`}>
                  <i data-tone={slice.tone} />
                  <span title={slice.label}>{slice.label}</span>
                  <b>{pct(slice.share)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="payer-concentration">
            <div className="payer-concentration-title"><span>Lectura de concentración</span><small>Apoyo descriptivo, no indicador de riesgo</small></div>
            <div className="payer-concentration-metrics">
              <article><strong>{pct(model.top1Share)}</strong><span>Mayor pagador</span></article>
              <article><strong>{pct(model.top3Share)}</strong><span>Top 3 pagadores</span></article>
              <article><strong>{model.transactionCount.toLocaleString('es-CL')}</strong><span>Registros de pago</span></article>
            </div>
            <div className="payer-ranking">
              {model.normalized.slice(0, 4).map((row, index) => {
                const share = model.total > 0 ? (row.value / model.total) * 100 : 0;
                return <div className="payer-ranking-row" key={`${row.label}-${index}`}>
                  <div><span>{index + 1}</span><strong title={row.label}>{row.label}</strong><small>{money(row.value)}</small></div>
                  <div className="payer-ranking-track"><i style={{ width: `${Math.max(3, share)}%` }} /></div>
                </div>;
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
