type TerritoryFilter =
  | { kind: 'all'; label: 'Todas las entidades' }
  | { kind: 'uaf'; label: 'Sujetos obligados UAF' }
  | { kind: 'sanction'; label: 'Con sanción' }
  | { kind: 'alert'; label: 'Con señal' }
  | { kind: 'finding'; label: 'Con hallazgos' }
  | { kind: 'sector'; label: string; value: string };

let activeFilter: TerritoryFilter = { kind: 'all', label: 'Todas las entidades' };
let activeDirectory: HTMLElement | null = null;

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

function currentDirectory() {
  return document.querySelector<HTMLElement>('[data-territory-directory="true"]');
}

function directoryPanel(directory: HTMLElement) {
  return directory.closest<HTMLElement>('.panel');
}

function rowMatches(row: HTMLElement, filter: TerritoryFilter) {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'sector') return normalize(row.dataset.sector) === normalize(filter.value);
  return row.dataset[filter.kind] === 'true';
}

function updateDirectory(filter: TerritoryFilter) {
  const directory = currentDirectory();
  if (!directory) return;

  if (activeDirectory !== directory) {
    activeDirectory = directory;
    activeFilter = { kind: 'all', label: 'Todas las entidades' };
  }

  const rows = [...directory.querySelectorAll<HTMLElement>('tbody tr[data-territory-entity="true"]')];
  let visible = 0;
  rows.forEach((row) => {
    const show = rowMatches(row, filter);
    row.hidden = !show;
    if (show) visible += 1;
  });

  const tbody = directory.querySelector<HTMLTableSectionElement>('tbody');
  let empty = tbody?.querySelector<HTMLTableRowElement>('tr[data-territory-filter-empty="true"]') ?? null;
  if (visible === 0 && tbody) {
    if (!empty) {
      empty = document.createElement('tr');
      empty.dataset.territoryFilterEmpty = 'true';
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'territory-directory-empty';
      empty.append(td);
      tbody.append(empty);
    }
    const td = empty.firstElementChild as HTMLTableCellElement | null;
    if (td) td.textContent = `Sin entidades para el filtro “${filter.label}”.`;
    empty.hidden = false;
  } else if (empty) {
    empty.hidden = true;
  }

  const panel = directoryPanel(directory);
  const title = panel?.querySelector<HTMLElement>('.panel-head h3');
  const meta = panel?.querySelector<HTMLElement>('.panel-head .meta');
  if (title) title.textContent = `Entidades domiciliadas · ${filter.kind === 'all' ? rows.length : `${visible} de ${rows.length}`}`;
  if (meta) {
    meta.textContent = filter.kind === 'all'
      ? 'marcas propias de entidad · clic en los gráficos para filtrar'
      : `filtro: ${filter.label} · clic otra vez para limpiar`;
  }

  activeFilter = filter;
  syncActiveGraphics(filter);
}

function syncActiveGraphics(filter: TerritoryFilter) {
  document.querySelectorAll<HTMLElement>('[data-territory-filter-active="true"]')
    .forEach((el) => delete el.dataset.territoryFilterActive);

  if (filter.kind === 'all') return;

  const context = document.querySelector<HTMLElement>('.territory-context-grid');
  if (!context) return;

  if (filter.kind === 'sector') {
    const panels = [...context.querySelectorAll<HTMLElement>('.panel')];
    const sectorPanel = panels.find((panel) => panel.querySelector('.panel-head h3')?.textContent?.includes('Sectores UAF presentes'));
    sectorPanel?.querySelectorAll<HTMLElement>('button').forEach((button) => {
      const label = button.querySelector('span')?.textContent?.trim() ?? '';
      if (normalize(label) === normalize(filter.value)) button.dataset.territoryFilterActive = 'true';
    });
    return;
  }

  const panels = [...context.querySelectorAll<HTMLElement>('.panel')];
  const universe = panels.find((panel) => panel.querySelector('.panel-head h3')?.textContent?.includes('Universo observado aquí'));
  if (!universe) return;
  const mapping: Record<string, TerritoryFilter['kind']> = {
    'sujetos obligados uaf': 'uaf',
    'con sancion': 'sanction',
    'con senal': 'alert',
    'hallazgos': 'finding',
  };
  universe.querySelectorAll<HTMLElement>('.kv dt').forEach((dt) => {
    if (mapping[normalize(dt.textContent)] === filter.kind) {
      dt.dataset.territoryFilterActive = 'true';
      const dd = dt.nextElementSibling as HTMLElement | null;
      if (dd) dd.dataset.territoryFilterActive = 'true';
    }
  });
}

function toggleFilter(next: TerritoryFilter) {
  const same = activeFilter.kind === next.kind
    && (next.kind !== 'sector' || (activeFilter.kind === 'sector' && normalize(activeFilter.value) === normalize(next.value)));
  updateDirectory(same ? { kind: 'all', label: 'Todas las entidades' } : next);
}

function panelTitle(el: Element | null) {
  return el?.closest('.panel')?.querySelector('.panel-head h3')?.textContent?.trim() ?? '';
}

function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target || !currentDirectory()) return;

  const sectorButton = target.closest<HTMLElement>('.territory-context-grid .panel button');
  if (sectorButton && panelTitle(sectorButton).includes('Sectores UAF presentes')) {
    const label = sectorButton.querySelector('span')?.textContent?.trim();
    if (label) toggleFilter({ kind: 'sector', label, value: label });
    return;
  }

  const kvCell = target.closest<HTMLElement>('.territory-context-grid .kv dt, .territory-context-grid .kv dd');
  if (!kvCell || !panelTitle(kvCell).includes('Universo observado aquí')) return;

  const dt = kvCell.tagName === 'DT' ? kvCell : kvCell.previousElementSibling as HTMLElement | null;
  const label = normalize(dt?.textContent);
  const map: Record<string, TerritoryFilter> = {
    'entidades': { kind: 'all', label: 'Todas las entidades' },
    'sujetos obligados uaf': { kind: 'uaf', label: 'Sujetos obligados UAF' },
    'con sancion': { kind: 'sanction', label: 'Con sanción' },
    'con senal': { kind: 'alert', label: 'Con señal' },
    'hallazgos': { kind: 'finding', label: 'Con hallazgos' },
  };
  if (map[label]) toggleFilter(map[label]);
}

function syncOnRender() {
  const directory = currentDirectory();
  if (!directory) {
    activeDirectory = null;
    activeFilter = { kind: 'all', label: 'Todas las entidades' };
    return;
  }
  if (directory !== activeDirectory) {
    activeDirectory = directory;
    activeFilter = { kind: 'all', label: 'Todas las entidades' };
    updateDirectory(activeFilter);
  }
}

document.addEventListener('click', handleClick);
new MutationObserver(syncOnRender).observe(document.documentElement, { childList: true, subtree: true });
syncOnRender();
