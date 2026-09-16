import { supabase } from './supabase';

export {};

const MENU_ATTR = 'data-atlas-report-nav';
let scheduled = false;
let roleLoaded = false;

function isReportsRoute() {
  return window.location.hash.startsWith('#/reportes');
}

function ensureReportsMenu() {
  const nav = document.querySelector<HTMLElement>('.topbar .nav');
  if (!nav) return;

  let link = nav.querySelector<HTMLAnchorElement>(`a[${MENU_ATTR}="true"]`);
  if (!link) {
    link = document.createElement('a');
    link.setAttribute(MENU_ATTR, 'true');
    link.href = '#/reportes';
    link.textContent = 'Informes';
    link.title = 'Informes institucionales UAF';

    const directLinks = Array.from(nav.children).filter((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    const fuentes = directLinks.find((item) => item.textContent?.trim() === 'Fuentes');
    if (fuentes) nav.insertBefore(link, fuentes);
    else nav.append(link);
  }

  link.dataset.active = isReportsRoute() ? 'true' : 'false';
}

function applyAiAccess(allowed: boolean) {
  document.documentElement.dataset.atlasReportAiAccess = allowed ? 'allowed' : 'denied';
  document.querySelectorAll<HTMLButtonElement>('.report-btn-ai').forEach((button) => {
    button.hidden = !allowed;
    button.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    if (!allowed) button.tabIndex = -1;
  });
}

async function resolveAiAccess() {
  if (roleLoaded) return;
  roleLoaded = true;
  document.documentElement.dataset.atlasReportAiAccess = 'pending';

  try {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) {
      applyAiAccess(false);
      return;
    }

    const { data, error } = await supabase
      .from('aml_allowed_users')
      .select('role,enabled')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !data?.enabled) {
      applyAiAccess(false);
      return;
    }

    const role = String(data.role ?? '').toLowerCase();
    applyAiAccess(role === 'admin' || role === 'analyst');
  } catch {
    applyAiAccess(false);
  }
}

function scan() {
  scheduled = false;
  ensureReportsMenu();
  const access = document.documentElement.dataset.atlasReportAiAccess;
  if (access === 'allowed') applyAiAccess(true);
  else if (access === 'denied') applyAiAccess(false);
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(scan);
}

const root = document.getElementById('root') ?? document.body;
new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleScan);
void resolveAiAccess();
scheduleScan();
