import { useEffect, useMemo, useState } from 'react';
import '../styles/huella-counterparty-explorer.css';

type CounterpartyKind = 'buyer' | 'payer';
type SortMode = 'amount' | 'count' | 'name' | 'recent';

type CounterpartyExplorerProps = {
  open: boolean;
  kind: CounterpartyKind;
  rows: any[];
  fromYear: number;
  toYear: number;
  excludeTop?: number;
  onClose: () => void;
  onOpen: (row: any) => void;
};

const PAGE_SIZE = 25;

function clp(value: number | null | undefined) {
  return value == null ? '—' : new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(Number(value));
}

function num(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toLocaleString('es-CL');
}

function yearRange(first?: number | null, last?: number | null) {
  if (!first && !last) return '—';
  return first === last ? String(first ?? last) : `${first ?? '…'}–${last ?? '…'}`;
}

function normalize(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9k]+/g, ' ')
    .trim();
}

export function HuellaCounterpartyExplorer({
  open,
  kind,
  rows,
  fromYear,
  toYear,
  excludeTop = 0,
  onClose,
  onOpen,
}: CounterpartyExplorerProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('amount');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSort('amount');
    setPage(1);
  }, [open, kind, excludeTop]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const model = useMemo(() => {
    const nameKey = kind === 'buyer' ? 'buyer_label' : 'payer_name';
    const fallbackKey = kind === 'buyer' ? 'buyer_id' : 'payer_key';
    const amountKey = kind === 'buyer' ? 'amount_clp' : 'amount_paid';
    const countKey = kind === 'buyer' ? 'order_count' : 'transaction_count';

    let data = rows.map((row, index) => ({
      row,
      index,
      label: String(row[nameKey] || row[fallbackKey] || 'Organismo s/d'),
      identifier: String(row[fallbackKey] || ''),
      amount: Number(row[amountKey] || 0),
      count: Number(row[countKey] || 0),
      firstYear: Number(row.first_year || fromYear),
      lastYear: Number(row.last_year || toYear),
    }));

    data.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'es'));
    if (excludeTop > 0) data = data.slice(excludeTop);

    const needle = normalize(query);
    if (needle) {
      data = data.filter((item) => normalize(`${item.label} ${item.identifier}`).includes(needle));
    }

    data.sort((a, b) => {
      if (sort === 'count') return b.count - a.count || b.amount - a.amount;
      if (sort === 'name') return a.label.localeCompare(b.label, 'es');
      if (sort === 'recent') return b.lastYear - a.lastYear || b.amount - a.amount;
      return b.amount - a.amount || b.count - a.count;
    });

    return data;
  }, [rows, kind, fromYear, toYear, excludeTop, query, sort]);

  useEffect(() => setPage(1), [query, sort]);

  if (!open) return null;

  const pages = Math.max(1, Math.ceil(model.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = model.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const title = kind === 'buyer' ? 'Organismos compradores' : 'Organismos pagadores';
  const source = kind === 'buyer' ? 'Mercado Público' : 'Presupuesto Abierto';

  return (
    <div className="huella-cp-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="huella-cp-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="huella-cp-head">
          <div>
            <span>{source}</span>
            <h2>{excludeTop > 0 ? `Otros ${title.toLowerCase()}` : title}</h2>
            <small>{model.length.toLocaleString('es-CL')} resultados en el período {fromYear}–{toYear}</small>
          </div>
          <button type="button" className="huella-cp-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="huella-cp-tools">
          <label className="huella-cp-search">
            <span aria-hidden="true">⌕</span>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por organismo, RUT o identificador…"
              aria-label={`Buscar en ${title.toLowerCase()}`}
            />
          </label>
          <label className="huella-cp-sort">
            <span>Ordenar por</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
              <option value="amount">Monto ↓</option>
              <option value="count">Registros ↓</option>
              <option value="name">Nombre A–Z</option>
              <option value="recent">Actividad reciente</option>
            </select>
          </label>
        </div>

        <div className="huella-cp-table-head" aria-hidden="true">
          <span>Organismo</span><span>Período</span><span>Registros</span><span>Monto</span><span />
        </div>
        <div className="huella-cp-list">
          {visible.length === 0 ? <div className="huella-cp-empty">No hay coincidencias para esta búsqueda.</div> : visible.map((item) => (
            <button type="button" className="huella-cp-row" key={`${item.identifier}-${item.index}`} onClick={() => onOpen(item.row)}>
              <span className="huella-cp-name"><strong>{item.label}</strong>{item.identifier && <small>{item.identifier}</small>}</span>
              <span>{yearRange(item.firstYear, item.lastYear)}</span>
              <span>{num(item.count)}</span>
              <span><strong>{clp(item.amount)}</strong></span>
              <span className="huella-cp-arrow">›</span>
            </button>
          ))}
        </div>

        <footer className="huella-cp-foot">
          <span>{model.length === 0 ? '0 resultados' : `${((currentPage - 1) * PAGE_SIZE + 1).toLocaleString('es-CL')}–${Math.min(currentPage * PAGE_SIZE, model.length).toLocaleString('es-CL')} de ${model.length.toLocaleString('es-CL')}`}</span>
          <div>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
            <b>{currentPage} / {pages}</b>
            <button type="button" disabled={currentPage >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Siguiente</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
