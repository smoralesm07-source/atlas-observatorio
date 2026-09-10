import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { n, n1 } from '../../lib/format';

/* Piezas compartidas por los dos ejes de Universo SO. Viven aparte porque la
   composición del padrón y la mesa de casos usan las mismas convenciones: un
   número nunca se imprime sin su denominador, una columna ordenable declara su
   orden a la tecnología asistiva, y todo lo que se puede copiar dice que se
   copió. */

export function SectionHead({
  kicker, title, hint, actions,
}: {
  kicker?: string;
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="uso-sechead">
      <div>
        {kicker && <span className="uso-kicker">{kicker}</span>}
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </div>
      {actions && <div className="uso-sechead-actions">{actions}</div>}
    </header>
  );
}

export function Tile({
  label, value, foot, tone, onClick, title,
}: {
  label: string;
  value: string;
  foot: string;
  tone?: string;
  onClick?: () => void;
  title?: string;
}) {
  const style = { ['--tile-tone' as string]: tone ?? 'var(--accent)' };
  const body = (
    <>
      <span className="uso-tile-label">{label}</span>
      <b className="uso-tile-value num">{value}</b>
      <em className="uso-tile-foot">{foot}</em>
    </>
  );
  return onClick ? (
    <button className="uso-tile" style={style} onClick={onClick} title={title ?? `Abrir ${label.toLowerCase()}`}>
      {body}
      <span className="uso-tile-go" aria-hidden>→</span>
    </button>
  ) : (
    <div className="uso-tile" style={style} title={title}>{body}</div>
  );
}

/** Una marca de caracterización: cuántos sujetos la llevan y qué parte del
 *  padrón es. Sin cohorte abrible se dibuja igual pero no promete una lista
 *  que no existe. */
export function MarkCard({
  label, value, total, hint, tone, onClick,
}: {
  label: string;
  value: number | null;
  total: number;
  hint: string;
  tone: string;
  onClick?: () => void;
}) {
  const share = value != null && total > 0 ? (value / total) * 100 : null;
  const style = { ['--mark-tone' as string]: tone };
  const body = (
    <>
      <span className="uso-mark-label">{label}</span>
      <b className="uso-mark-value num">{n(value)}</b>
      <span className="uso-mark-track" aria-hidden>
        <i style={{ width: `${Math.min(100, Math.max(share ?? 0, share ? 1.2 : 0))}%` }} />
      </span>
      <em className="uso-mark-foot">
        {share == null ? 'sin medir' : `${n1(share)}% del padrón`} · {hint}
      </em>
    </>
  );
  return onClick ? (
    <button className="uso-mark" style={style} onClick={onClick} data-open="true">
      {body}
      <span className="uso-mark-go" aria-hidden>→</span>
    </button>
  ) : (
    <div className="uso-mark" style={style}>{body}</div>
  );
}

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string> {
  field: K;
  dir: SortDir;
  toggle: (field: K) => void;
  ariaSort: (field: K) => 'ascending' | 'descending' | 'none';
}

/** Ordenar una cola es parte del trabajo, no una preferencia: el fiscalizador
 *  llega buscando «los más grandes» o «los más recientes». Numérico baja por
 *  omisión, texto sube. */
export function useSort<K extends string>(initial: K, initialDir: SortDir = 'desc'): SortState<K> {
  const [field, setField] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const toggle = useCallback((next: K) => {
    setField((current) => {
      if (current === next) {
        setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
        return current;
      }
      setDir('desc');
      return next;
    });
  }, []);
  const ariaSort = useCallback(
    (f: K) => (f !== field ? 'none' as const : dir === 'asc' ? 'ascending' as const : 'descending' as const),
    [field, dir],
  );
  return { field, dir, toggle, ariaSort };
}

export function SortTh<K extends string>({
  sort, field, label, hint, align = 'right', width,
}: {
  sort: SortState<K>;
  field: K;
  label: string;
  hint?: string;
  align?: 'left' | 'right';
  width?: number;
}) {
  const active = sort.field === field;
  return (
    <th
      className={align === 'right' ? 'right uso-sortth' : 'uso-sortth'}
      aria-sort={sort.ariaSort(field)}
      style={width ? { width } : undefined}
    >
      <button
        onClick={() => sort.toggle(field)}
        data-on={active}
        title={hint ?? `Ordenar por ${label.toLowerCase()}`}
        aria-label={`Ordenar por ${label.toLowerCase()}${active ? (sort.dir === 'asc' ? ', ascendente' : ', descendente') : ''}`}
      >
        <span>{label}</span>
        <i aria-hidden>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '·'}</i>
      </button>
    </th>
  );
}

/** Comparador estable: los nulos van siempre al final, en los dos sentidos.
 *  Un sector sin ROS medido no puede encabezar el orden por ROS. */
export function compareBy<T>(
  a: T, b: T, get: (row: T) => number | string | null | undefined, dir: SortDir,
): number {
  const va = get(a);
  const vb = get(b);
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === 'string' || typeof vb === 'string') {
    const cmp = String(va).localeCompare(String(vb), 'es');
    return dir === 'asc' ? cmp : -cmp;
  }
  return dir === 'asc' ? va - vb : vb - va;
}

export function CopyButton({
  text, label = 'Copiar', done = 'Copiado', small = false, title,
}: {
  text: string;
  label?: string;
  done?: string;
  small?: boolean;
  title?: string;
}) {
  const [ok, setOk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    const flash = () => {
      setOk(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOk(false), 1600);
    };
    try {
      await navigator.clipboard.writeText(text);
      flash();
    } catch {
      // Sin permiso de portapapeles queda el camino manual del navegador.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); flash(); } catch { /* sin portapapeles */ }
      document.body.removeChild(area);
    }
  };

  return (
    <button className={small ? 'uso-copy uso-copy-sm' : 'uso-copy'} onClick={copy} data-ok={ok} title={title ?? label}>
      <i aria-hidden>{ok ? '✓' : '⧉'}</i>
      <span>{ok ? done : label}</span>
    </button>
  );
}

export function Pill({ tone, children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className="uso-pill" style={{ ['--pill-tone' as string]: tone ?? 'var(--ink-3)' }} title={title}>
      {children}
    </span>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="uso-field" data-wide={wide ? 'true' : undefined}>
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

/** Selector nativo: en una barra de filtros con seis dimensiones, un menú
 *  propio sería más bonito y peor. El nativo es accesible y rápido de teclado. */
export function Select({
  label, value, options, onChange, allLabel = 'Todos',
}: {
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  const id = useMemo(() => `uso-sel-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <label className="uso-select" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-on={value !== ''}>
        <option value="">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}{opt.count != null ? ` (${n(opt.count)})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
