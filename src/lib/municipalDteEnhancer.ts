export {};

function text(node: Element | null) {
  return (node?.textContent ?? '').trim();
}

function enhanceMunicipalDte() {
  if (window.location.hash !== '#/relacion-estado') return;

  for (const card of document.querySelectorAll<HTMLElement>('.agency-result-card')) {
    const semantics = [...card.querySelectorAll<HTMLElement>('.agency-semantics')];
    const coverage = semantics.find((node) => /Monitor Municipal\/DTE integrado/i.test(text(node)));
    if (!coverage) continue;

    card.dataset.municipalDte = 'true';

    for (const kpi of card.querySelectorAll<HTMLElement>('.state-kpi')) {
      const label = kpi.querySelector<HTMLElement>('span');
      const small = kpi.querySelector<HTMLElement>('small');
      if (!label) continue;

      if (text(label) === 'Flujos a contrapartes') {
        label.textContent = 'DTE municipales observados';
        if (small && /Cobertura municipal pendiente/i.test(text(small))) {
          small.textContent = 'Presupuesto Abierto Municipal · cobertura parcial';
        }
      }

      if (text(label) === 'Ejecución devengada' && small) {
        small.textContent = 'No disponible en la fuente municipal DTE';
      }
    }

    const headers = card.querySelectorAll<HTMLTableCellElement>('.agency-table thead th');
    for (const header of headers) {
      if (text(header) === 'Flujos Presupuesto Abierto') {
        header.textContent = 'DTE Presupuesto Abierto';
      }
    }

    for (const row of card.querySelectorAll<HTMLTableRowElement>('.agency-table tbody tr')) {
      const cells = row.querySelectorAll<HTMLTableCellElement>('td');
      const fundsCell = cells[1];
      if (!fundsCell) continue;
      const detail = fundsCell.querySelector<HTMLElement>('small');
      const amount = text(fundsCell.querySelector('b'));
      if (detail && amount && amount !== '—') {
        detail.textContent = 'DTE observado · no acredita pago efectivo';
      }
    }

    const reading = semantics.find((node) => /^Lectura:/i.test(text(node)));
    if (reading && !reading.dataset.municipalDte) {
      reading.dataset.municipalDte = 'true';
      reading.innerHTML = '<b>Lectura municipal:</b> Presupuesto Abierto Municipal muestra DTE emitidos y no rechazados observados por contraparte. El monto neto descuenta notas de crédito; no equivale a ejecución devengada ni acredita pago efectivo. Mercado Público se mantiene como una fuente separada y los montos no se suman.';
    }
  }
}

let scheduled = false;
function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceMunicipalDte();
  });
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
window.addEventListener('hashchange', scheduleEnhancement);
window.addEventListener('load', scheduleEnhancement);
scheduleEnhancement();
