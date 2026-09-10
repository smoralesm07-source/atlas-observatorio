/* ATLAS Observatorio · readability floor
   Enforces the typographic minimum already used by the Fuentes view (10.5 px)
   without flattening the hierarchy of larger labels, values or headings.

   Why runtime instead of a universal CSS font-size rule:
   the app has several independent dense workspaces with hard-coded sizes.
   Reading the computed size lets us raise only text that actually falls below
   the floor and leave every element that is already larger untouched. */

const ATLAS_TEXT_FLOOR_PX = 10.5;
const FLOOR_CLASS = 'atlas-text-floor';
const APP_ROOT_SELECTOR = '.main';
const FORM_CONTROL_SELECTOR = 'input, textarea, select, button';
const NON_TEXT_SELECTOR = 'svg, canvas, script, style, noscript';

let scheduled = false;

function hasDirectText(element: HTMLElement) {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );
}

function shouldMeasure(element: HTMLElement) {
  if (element.matches(NON_TEXT_SELECTOR) || element.closest('svg')) return false;
  if (element.matches(FORM_CONTROL_SELECTOR)) return true;
  return hasDirectText(element);
}

function enforceFloor(element: HTMLElement) {
  if (!shouldMeasure(element)) return;

  // Remove our own override before measuring so responsive rules can still
  // promote an element above the floor at wider breakpoints.
  const hadFloor = element.classList.contains(FLOOR_CLASS);
  if (hadFloor) element.classList.remove(FLOOR_CLASS);

  const size = Number.parseFloat(window.getComputedStyle(element).fontSize);
  if (Number.isFinite(size) && size < ATLAS_TEXT_FLOOR_PX) {
    element.classList.add(FLOOR_CLASS);
  }
}

function scanTypography() {
  scheduled = false;
  document.querySelectorAll<HTMLElement>(APP_ROOT_SELECTOR).forEach((root) => {
    enforceFloor(root);
    root.querySelectorAll<HTMLElement>('*').forEach(enforceFloor);
  });
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(scanTypography);
}

const observedRoot = document.getElementById('root') ?? document.body;
const observer = new MutationObserver(scheduleScan);
observer.observe(observedRoot, { childList: true, subtree: true });

window.addEventListener('resize', scheduleScan, { passive: true });
void document.fonts?.ready.then(scheduleScan);
scheduleScan();
