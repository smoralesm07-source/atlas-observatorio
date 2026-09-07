import { useId } from 'react';
import { n, n1, toneVar, type Tone } from '../lib/format';

/* Hand-rolled SVG. Charts here are read at a glance during a monitoring pass,
   so every mark is either a magnitude or a rank — never decoration. */

export function Bars({
  data,
  max,
  height = 150,
  onPick,
}: {
  data: { label: string; value: number; tone?: Tone; sub?: string }[];
  max?: number;
  height?: number;
  onPick?: (label: string) => void;
}) {
  const peak = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minHeight: height }}>
      {data.map((d) => {
        const w = Math.max(1.5, (d.value / peak) * 100);
        const color = d.tone ? toneVar(d.tone) : 'var(--accent)';
        return (
          <button
            key={d.label}
            onClick={onPick ? () => onPick(d.label) : undefined}
            style={{
              display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '3px 12px',
              alignItems: 'baseline', border: 0, background: 'transparent', padding: 0,
              textAlign: 'left', cursor: onPick ? 'pointer' : 'default', width: '100%',
            }}
          >
            <span
              style={{
                fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {d.label}
            </span>
            <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {n(d.value)}
              {d.sub && <em style={{ color: 'var(--ink-4)', fontStyle: 'normal', marginLeft: 6 }}>{d.sub}</em>}
            </span>
            <span
              style={{
                gridColumn: '1 / -1', height: 5, borderRadius: 3,
                background: 'var(--bg-raised)', overflow: 'hidden',
              }}
            >
              <span
                style={{
                  display: 'block', height: '100%', width: `${w}%`, borderRadius: 3,
                  background: color, transition: 'width .5s cubic-bezier(.22,.61,.36,1)',
                }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Priority is ordered, so the ring is drawn in priority order, not by size. */
export function PriorityRing({
  segments,
  total,
  size = 168,
}: {
  segments: { label: string; value: number; tone: Tone }[];
  total: number;
  size?: number;
}) {
  const stroke = 15;
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  const sum = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribución por prioridad">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-raised)" strokeWidth={stroke} />
          {segments.map((s) => {
            const len = (s.value / sum) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={toneVar(s.tone)} strokeWidth={stroke}
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              >
                <title>{`${s.label}: ${n(s.value)}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </g>
        <text
          x="50%" y="47%" textAnchor="middle" className="num"
          style={{ fontSize: 30, fontWeight: 700, fill: 'var(--ink)', letterSpacing: '-0.03em' }}
        >
          {n(total)}
        </text>
        <text
          x="50%" y="60%" textAnchor="middle"
          style={{ fontSize: 10, fill: 'var(--ink-3)', letterSpacing: '0.11em', textTransform: 'uppercase', fontWeight: 600 }}
        >
          señales
        </text>
      </svg>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 150 }}>
        {segments.map((s) => (
          <li key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
            <i style={{ width: 9, height: 9, borderRadius: 2, background: toneVar(s.tone), flexShrink: 0 }} />
            <span style={{ color: 'var(--ink-2)', flex: 1 }}>{s.label}</span>
            <span className="num" style={{ fontWeight: 650 }}>{n(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ambient sparkline behind a stat tile: shape only, never a readable series. */
export function Sparkline({
  points,
  width = 108,
  height = 34,
  color = 'var(--accent)',
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const gid = useId();
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => [i * step, height - ((p - min) / span) * (height - 5) - 2] as const);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Territory strip: entities as width, alerted share as an inset bar. */
export function TerritoryStrip({
  rows,
  onPick,
}: {
  rows: { region: string; entities: number; sanctioned: number; alerted: number; avg_priority: number | null }[];
  onPick?: (region: string) => void;
}) {
  const peak = Math.max(1, ...rows.map((r) => r.entities));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r) => {
        const w = (r.entities / peak) * 100;
        const flagged = r.entities ? (r.sanctioned / r.entities) * 100 : 0;
        return (
          <button
            key={r.region}
            onClick={onPick ? () => onPick(r.region) : undefined}
            style={{
              display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 64px', gap: '2px 10px',
              alignItems: 'center', border: 0, background: 'transparent', padding: '2px 0',
              cursor: onPick ? 'pointer' : 'default', textAlign: 'left', width: '100%',
            }}
            title={`${r.region} · ${n(r.entities)} entidades · ${n(r.sanctioned)} sancionadas`}
          >
            <span style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.region}
            </span>
            <span className="num" style={{ fontSize: 11.5, textAlign: 'right', color: 'var(--ink-3)' }}>
              {n(r.entities)}
            </span>
            <span style={{ gridColumn: '1 / -1', position: 'relative', height: 7, borderRadius: 3, background: 'var(--bg-raised)', overflow: 'hidden' }}>
              <span style={{ position: 'absolute', inset: 0, width: `${w}%`, background: 'color-mix(in srgb, var(--accent) 32%, transparent)', borderRadius: 3 }} />
              <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${(w * flagged) / 100}%`, background: 'var(--sig-critical)', borderRadius: 3 }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Coverage meter used on the ficha: how much of the governed universe a
 *  source actually reaches. */
export function Meter({ value, label, hint }: { value: number; label: string; hint?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 5 }}>
        <span style={{ color: 'var(--ink-3)' }}>{label}</span>
        <span className="num" style={{ fontWeight: 650 }}>{n1(value)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-raised)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%', width: `${v}%`, borderRadius: 3,
            background: v >= 66 ? 'var(--present)' : v >= 33 ? 'var(--sig-medium)' : 'var(--sig-high)',
            transition: 'width .5s cubic-bezier(.22,.61,.36,1)',
          }}
        />
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
