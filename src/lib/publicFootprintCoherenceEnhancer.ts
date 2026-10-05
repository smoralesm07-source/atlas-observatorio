import { supabase } from './supabase';

export {};

type FootprintRow = {
  payer_key?: string | null;
  payer_name?: string | null;
  amount_paid?: number | null;
  transaction_count?: number | null;
  municipal_dte_amount?: number | null;
  municipal_dte_document_count?: number | null;
  source_kind?: string | null;
  source_kinds?: string[] | null;
  payment_proof?: boolean | null;
};

type PayersResponse = { rows?: FootprintRow[] };

const cache = new Map<string, FootprintRow[]>();
let requestKey = '';
let requestSerial = 0;
let scheduled = false;
let lastDomSignature = '';

function norm(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9K]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normRut(value: unknown) {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function numberLabel(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString('es-CL') : '—';
}

function selectedRut() {
  const raw = document.querySelector<HTMLElement>('.state-detail-title small')?.textContent ?? '';
  return normRut(raw).length >= 7 ? raw.trim() : '';
}

function selectedPeriod() {
  const inputs = [...document.querySelectorAll<HTMLInputElement>('.huella-global-period input')];
  const current = new Date().getFullYear();
  const from = Math.max(2016, Number(inputs[0]?.value || 2020) || 2020);
  const to = Math.min(current, Math.max(from, Number(inputs[1]?.value || current) || current));
  return { from, to };
}

function isEntityHuellaRoute() {
  return window.location.hash === '#/relacion-estado';
}

function domSignature() {
  const { from, to } = selectedPeriod();
  const list = document.querySelector<HTMLElement>('.huella-detail-list');
  const listTitle = list?.querySelector<HTMLElement>('.huella-detail-list-head strong')?.textContent ?? '';
  const visibleRows = [...(list?.querySelectorAll<HTMLElement>('.detail-row-button') ?? [])]
    .map((row) => `${row.querySelector('b')?.textContent ?? ''}:${row.querySelectorAll('small')[1]?.textContent ?? ''}`)
    .join('|');
  const drawer = document.querySelector<HTMLElement>('.state-counterparty-drawer');
  const drawerState = drawer
    ? `${drawer.querySelector('h3')?.textContent ?? ''}:${Boolean(drawer.querySelector('.public-footprint-method-note'))}`
    : '';
  return [window.location.hash, selectedRut(), from, to, listTitle, visibleRows, drawerState].join('::');
}

function renameGenericLabels() {
  if (!isEntityHuellaRoute()) return;

  for (const button of document.querySelectorAll<HTMLButtonElement>('.huella-search-filters button')) {
    if (button.textContent?.trim() === 'Pagos Estado') button.textContent = 'Huella Estado';
  }

  for (const pill of document.querySelectorAll<HTMLElement>('.state-source-pills em')) {
    if (pill.textContent?.trim() === 'Pagos Estado') pill.textContent = 'Huella Estado';
  }

  for (const list of document.querySelectorAll<HTMLElement>('.huella-detail-list')) {
    const title = list.querySelector<HTMLElement>('.huella-detail-list-head strong');
    if (!title || !/^(¿Quién le ha pagado\?|Organismos con huella pública)$/i.test(title.textContent?.trim() ?? '')) continue;
    if (title.textContent !== 'Organismos con huella pública') title.textContent = 'Organismos con huella pública';
    const source = title.parentElement?.querySelector<HTMLElement>('span');
    const sourceText = 'Presupuesto Abierto · pagos + DTE municipal';
    if (source && source.textContent !== sourceText) source.textContent = sourceText;
  }

  const explorer = document.querySelector<HTMLElement>('.counterparty-explorer');
  if (explorer) {
    for (const node of explorer.querySelectorAll<HTMLElement>('h2,h3,strong,span')) {
      const value = node.textContent?.trim();
      if (value === 'Organismos pagadores') node.textContent = 'Organismos con huella pública';
      if (value === 'Presupuesto Abierto') node.textContent = 'Presupuesto Abierto · pagos + DTE municipal';
    }
  }
}

function findEvidence(rows: FootprintRow[], label: string, identifier = '') {
  const targetRut = normRut(identifier);
  if (targetRut.length >= 7) {
    const exact = rows.find((row) => normRut(row.payer_key) === targetRut);
    if (exact) return exact;
  }
  const target = norm(label);
  if (!target) return undefined;
  return rows.find((row) => norm(row.payer_name) === target)
    ?? rows.find((row) => norm(row.payer_name).includes(target) || target.includes(norm(row.payer_name)));
}

function decorateList(rows: FootprintRow[]) {
  for (const list of document.querySelectorAll<HTMLElement>('.huella-detail-list')) {
    const title = list.querySelector<HTMLElement>('.huella-detail-list-head strong');
    if (title?.textContent?.trim() !== 'Organismos con huella pública') continue;

    for (const rowEl of list.querySelectorAll<HTMLButtonElement>('.detail-row-button')) {
      const columns = rowEl.querySelectorAll<HTMLElement>(':scope > span');
      const label = columns[0]?.querySelector<HTMLElement>('b')?.textContent ?? '';
      const evidence = findEvidence(rows, label);
      if (!evidence) continue;

      const detail = columns[1]?.querySelector<HTMLElement>('small');
      const amount = columns[1]?.querySelector<HTMLElement>('b');
      const municipalOnly = evidence.source_kind === 'MUNICIPAL_DTE' && evidence.payment_proof === false;
      const mixed = Array.isArray(evidence.source_kinds) && evidence.source_kinds.includes('MUNICIPAL_DTE') && !municipalOnly;

      if (municipalOnly) {
        rowEl.dataset.publicEvidence = 'municipal-dte';
        const docs = evidence.municipal_dte_document_count ?? evidence.transaction_count;
        const detailText = `${numberLabel(docs)} DTE · huella observada`;
        if (detail && detail.textContent !== detailText) detail.textContent = detailText;
        if (amount) {
          amount.title = 'Monto neto de DTE municipales observados; no acredita pago efectivo.';
          amount.dataset.evidence = 'municipal-dte';
        }
        const identity = columns[0];
        if (identity && !identity.querySelector('.public-footprint-evidence-badge')) {
          const badge = document.createElement('small');
          badge.className = 'public-footprint-evidence-badge';
          badge.textContent = 'DTE municipal';
          identity.appendChild(badge);
        }
      } else if (mixed) {
        rowEl.dataset.publicEvidence = 'mixed';
        const detailText = `${numberLabel(evidence.transaction_count)} pagos · + evidencia DTE`;
        if (detail && detail.textContent !== detailText) detail.textContent = detailText;
      } else {
        rowEl.dataset.publicEvidence = 'payment';
      }
    }
  }
}

function decorateDrawer(rows: FootprintRow[]) {
  const drawer = document.querySelector<HTMLElement>('.state-counterparty-drawer');
  if (!drawer) return;
  const header = drawer.querySelector<HTMLElement>('.state-counterparty-head');
  if (!header) return;

  const label = header.querySelector<HTMLElement>('h3')?.textContent ?? '';
  const headerSmall = header.querySelector<HTMLElement>('small');
  const identifier = headerSmall?.textContent?.split('·').at(-1)?.trim() ?? '';
  const evidence = findEvidence(rows, label, identifier);
  if (!evidence || evidence.source_kind !== 'MUNICIPAL_DTE' || evidence.payment_proof !== false) return;

  drawer.dataset.publicEvidence = 'municipal-dte';
  const eyebrow = header.querySelector<HTMLElement>('span');
  if (eyebrow?.textContent !== 'Organismo con huella DTE') eyebrow && (eyebrow.textContent = 'Organismo con huella DTE');
  const headerText = `Presupuesto Abierto Municipal${evidence.payer_key ? ` · ${evidence.payer_key}` : ''}`;
  if (headerSmall && headerSmall.textContent !== headerText) headerSmall.textContent = headerText;

  const facts = drawer.querySelectorAll<HTMLElement>('.state-counterparty-facts > div');
  const amountLabel = facts[0]?.querySelector<HTMLElement>('span');
  const countLabel = facts[1]?.querySelector<HTMLElement>('span');
  if (amountLabel?.textContent !== 'Monto DTE neto') amountLabel && (amountLabel.textContent = 'Monto DTE neto');
  if (countLabel?.textContent !== 'DTE observados') countLabel && (countLabel.textContent = 'DTE observados');

  for (const node of drawer.querySelectorAll<HTMLElement>('span,small')) {
    if (node.textContent?.trim() === 'Pago observado') node.textContent = 'DTE observado';
    if (node.textContent?.trim() === 'por transacción') node.textContent = 'por DTE observado';
  }

  if (!drawer.querySelector('.public-footprint-method-note')) {
    const note = document.createElement('div');
    note.className = 'public-footprint-method-note';
    note.innerHTML = '<b>Tipo de evidencia:</b> DTE municipal observado. Esta relación acredita huella pública entre el organismo y la entidad, pero no prueba pago efectivo ni ejecución devengada.';
    const factsSection = drawer.querySelector('.state-counterparty-facts');
    factsSection?.insertAdjacentElement('afterend', note);
  }
}

function applyRows(rows: FootprintRow[]) {
  renameGenericLabels();
  decorateList(rows);
  decorateDrawer(rows);
}

async function refreshEvidence() {
  const before = domSignature();
  if (before === lastDomSignature) return;

  renameGenericLabels();
  if (!isEntityHuellaRoute()) {
    lastDomSignature = domSignature();
    return;
  }
  const rut = selectedRut();
  if (!rut) {
    lastDomSignature = domSignature();
    return;
  }
  const { from, to } = selectedPeriod();
  const key = `${normRut(rut)}|${from}|${to}`;
  requestKey = key;

  const cached = cache.get(key);
  if (cached) {
    applyRows(cached);
    lastDomSignature = domSignature();
    return;
  }

  const serial = ++requestSerial;
  const { data, error } = await supabase.rpc('obs_state_public_funds_entity', {
    p_action: 'payers',
    p_rut: rut,
    p_query: null,
    p_from_year: from,
    p_to_year: to,
    p_limit: 500,
    p_offset: 0,
  });
  if (serial !== requestSerial || requestKey !== key || error) return;
  const rows = ((data as PayersResponse | null)?.rows ?? []) as FootprintRow[];
  cache.set(key, rows);
  applyRows(rows);
  lastDomSignature = domSignature();
}

function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    void refreshEvidence();
  });
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
window.addEventListener('hashchange', () => {
  lastDomSignature = '';
  scheduleEnhancement();
});
window.addEventListener('load', scheduleEnhancement);
scheduleEnhancement();
