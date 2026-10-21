import { useState } from 'react';
import { n } from '../format';

export interface Bar {
  label: string;
  value: number;
  detail?: string;
}

/* Barras de una sola serie. Una sola serie no lleva leyenda: el título de la
   tarjeta la nombra. Horizontal para categorías con nombres largos; columnas
   para años. El tooltip sigue al puntero y el área sensible es la fila
   completa, más grande que la barra. */

export function HBars({ data, unit, max: maxRows = 10 }: { data: Bar[]; unit: string; max?: number }) {
  const rows = data.slice(0, maxRows);
  const rest = data.slice(maxRows).reduce((s, d) => s + d.value, 0);
  if (rest > 0) rows.push({ label: `Otras (${data.length - maxRows})`, value: rest });
  const max = Math.max(1, ...rows.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <p className="empty">Sin datos en este corte.</p>;
  return (
    <ul className="hbars" role="list">
      {rows.map((d, i) => (
        <li key={d.label} className="hbar-row" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            aria-label={`${d.label}: ${n(d.value)} ${unit}${d.detail ? `. ${d.detail}` : ''}`}>
          <span className="hbar-label" title={d.label}>{d.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="hbar-value">{n(d.value)}</span>
          {hover === i && (
            <span className="tip" role="tooltip">
              <strong>{d.label}</strong>
              <span>{n(d.value)} {unit}</span>
              {d.detail && <span className="tip-muted">{d.detail}</span>}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Columns({ data, unit }: { data: Bar[]; unit: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="empty">Sin datos en este corte.</p>;
  return (
    <div className="cols" role="list">
      {data.map((d, i) => (
        <div key={d.label} className="col" role="listitem" tabIndex={0}
             onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
             onFocus={() => setHover(i)} onBlur={() => setHover(null)}
             aria-label={`${d.label}: ${n(d.value)} ${unit}`}>
          <span className="col-value">{n(d.value)}</span>
          <span className="col-track">
            <span className="col-fill" style={{ height: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="col-label">{d.label}</span>
          {hover === i && (
            <span className="tip tip-col" role="tooltip">
              <strong>{d.label}</strong>
              <span>{n(d.value)} {unit}</span>
              {d.detail && <span className="tip-muted">{d.detail}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
