/* Gestión SO · controlador del drawer de casos.
   Mantiene la cartera como superficie principal y abre la ficha sólo cuando el
   analista selecciona una entidad. No reparenta nodos de React: únicamente
   activa el modo flotante mediante atributos/clases, por lo que la lógica de
   la ficha sigue siendo la misma y el único scroll activo es el del drawer. */

const WORK_SELECTOR = '.uso-mode-casos .uso-work';
const ROW_SELECTOR = '.uso-row-main[data-caserow]';
const CLOSE_SELECTOR = '.uso-back';
const OPEN_ATTR = 'data-case-drawer-open';

function flushFocusedField(detail: HTMLElement | null) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && detail?.contains(active)) active.blur();
}

function openDrawer(work: HTMLElement, trigger?: HTMLElement | null) {
  const detail = work.querySelector<HTMLElement>('.uso-detail');
  if (!detail) return;

  work.setAttribute(OPEN_ATTR, 'true');
  document.body.classList.add('uso-case-drawer-open');
  detail.setAttribute('role', 'dialog');
  detail.setAttribute('aria-modal', 'true');
  detail.setAttribute('aria-label', 'Ficha de Gestión SO');

  if (trigger?.dataset.caserow) work.dataset.caseDrawerTrigger = trigger.dataset.caserow;

  requestAnimationFrame(() => {
    detail.scrollTop = 0;
    const close = detail.querySelector<HTMLButtonElement>(CLOSE_SELECTOR);
    close?.focus({ preventScroll: true });
  });
}

function closeDrawer(work: HTMLElement, restoreFocus = true) {
  const detail = work.querySelector<HTMLElement>('.uso-detail');
  flushFocusedField(detail);

  work.removeAttribute(OPEN_ATTR);
  document.body.classList.remove('uso-case-drawer-open');
  detail?.removeAttribute('role');
  detail?.removeAttribute('aria-modal');
  detail?.removeAttribute('aria-label');

  if (!restoreFocus) return;
  const key = work.dataset.caseDrawerTrigger;
  delete work.dataset.caseDrawerTrigger;
  if (!key) return;
  requestAnimationFrame(() => {
    const rows = work.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR);
    Array.from(rows).find((row) => row.dataset.caserow === key)?.focus({ preventScroll: true });
  });
}

function closeAll(restoreFocus = false) {
  document.querySelectorAll<HTMLElement>(`${WORK_SELECTOR}[${OPEN_ATTR}="true"]`)
    .forEach((work) => closeDrawer(work, restoreFocus));
}

/* Captura temprana: el botón heredado “Volver a la lista” se convierte en el
   cierre real del drawer y no alcanza a ejecutar el scroll antiguo. */
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const close = target.closest<HTMLElement>(CLOSE_SELECTOR);
  if (close) {
    const work = close.closest<HTMLElement>(WORK_SELECTOR);
    if (work?.getAttribute(OPEN_ATTR) === 'true') {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer(work);
    }
    return;
  }

  const row = target.closest<HTMLElement>(ROW_SELECTOR);
  if (row) {
    const work = row.closest<HTMLElement>(WORK_SELECTOR);
    if (work) requestAnimationFrame(() => openDrawer(work, row));
    return;
  }

  /* El velo es un ::before del propio .uso-work. Al pulsarlo, el target nativo
     es el contenedor, así que se puede cerrar sin agregar otro nodo al árbol. */
  const work = target.closest<HTMLElement>(WORK_SELECTOR);
  if (work && target === work && work.getAttribute(OPEN_ATTR) === 'true') {
    event.preventDefault();
    closeDrawer(work);
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const open = document.querySelector<HTMLElement>(`${WORK_SELECTOR}[${OPEN_ATTR}="true"]`);
  if (!open) return;
  event.preventDefault();
  closeDrawer(open);
});

window.addEventListener('hashchange', () => closeAll(false));
