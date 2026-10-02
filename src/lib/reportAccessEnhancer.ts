import { supabase } from './supabase';

export {};

let scheduled = false;
let roleLoaded = false;

function installGuardedAiRoute() {
  const functionsClient = supabase.functions as any;
  const prototype = Object.getPrototypeOf(functionsClient) as any;
  if (!prototype || prototype.__atlasReportGuarded) return;
  const originalInvoke = prototype.invoke;
  if (typeof originalInvoke !== 'function') return;
  prototype.invoke = function (name: string, options?: unknown) {
    return originalInvoke.call(this, name === 'atlas-report-narrative' ? 'atlas-report-narrative-guarded' : name, options);
  };
  prototype.__atlasReportGuarded = true;
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
  const access = document.documentElement.dataset.atlasReportAiAccess;
  if (access === 'allowed') applyAiAccess(true);
  else if (access === 'denied') applyAiAccess(false);
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(scan);
}

installGuardedAiRoute();
const root = document.getElementById('root') ?? document.body;
new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleScan);
void resolveAiAccess();
scheduleScan();
