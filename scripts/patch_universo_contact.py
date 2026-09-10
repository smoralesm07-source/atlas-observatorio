from pathlib import Path
import re

ROOT = Path('.')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'No se encontró patrón para {label}')
    return text.replace(old, new, 1)

component = r'''import { useMemo, useState } from 'react';
import { useRpc } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import type { CaseContact, CaseRecord } from '../../lib/casework';
import { LOCATE_LIMIT, locateGroups, locateQueriesText } from '../../lib/osint';
import { n, n1 } from '../../lib/format';
import { CopyButton } from './bits';
import type { CaseRow } from './model';
import '../../styles/universo-contact.css';

type OpenContact = {
  contact_id: string;
  contact_type: string;
  contact_value: string;
  source_label: string | null;
  source_url: string | null;
  confidence_pct: number | null;
  verification_status: string | null;
  evidence_note: string | null;
  evidence_count: number | null;
  source_domains: string[] | null;
  last_observed_at: string | null;
  updated_at: string | null;
  analyst_note: string | null;
};

type EnrichmentResult = {
  job_id?: string;
  engine_version?: string;
  sources_scanned?: number;
  discovery_queries?: number;
  discovered_urls?: number;
  findings?: unknown[];
};

type ContactField = keyof Pick<CaseContact, 'telefono' | 'correo' | 'sitio' | 'direccion'>;

const FIELD_BY_TYPE: Record<string, ContactField | undefined> = {
  TELEFONO: 'telefono',
  EMAIL: 'correo',
  WEB: 'sitio',
  DIRECCION: 'direccion',
};

const TYPE_LABEL: Record<string, string> = {
  TELEFONO: 'Teléfono',
  EMAIL: 'Correo',
  WEB: 'Sitio web',
  DIRECCION: 'Domicilio',
};

const TYPE_GLYPH: Record<string, string> = {
  TELEFONO: 'T',
  EMAIL: '@',
  WEB: 'W',
  DIRECCION: 'D',
};

const STATUS_LABEL: Record<string, string> = {
  VERIFICADO: 'Verificado',
  PROBABLE: 'Probable',
  NO_VERIFICADO: 'No verificado',
};

const statusRank = (status: string | null) => status === 'VERIFICADO' ? 3 : status === 'PROBABLE' ? 2 : 1;

function host(url: string | null): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function dateLabel(value: string | null): string {
  if (!value) return 'sin fecha';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'sin fecha';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function directHref(contact: OpenContact): string | null {
  if (contact.contact_type === 'EMAIL') return `mailto:${contact.contact_value}`;
  if (contact.contact_type === 'TELEFONO') return `tel:${contact.contact_value.replace(/\s+/g, '')}`;
  if (contact.contact_type === 'WEB') {
    return /^https?:\/\//i.test(contact.contact_value) ? contact.contact_value : `https://${contact.contact_value}`;
  }
  return null;
}

export function OpenContactPanel({
  row,
  onPatch,
}: {
  row: CaseRow;
  onPatch: (patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> }) => void;
}) {
  const contacts = useRpc<OpenContact[]>('obs_uaf_contact_osint', {
    p_rut: row.subject.rut,
    p_entity_id: row.subject.entityId,
  });
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const items = useMemo(
    () => (contacts.data ?? []).slice().sort((a, b) => {
      const status = statusRank(b.verification_status) - statusRank(a.verification_status);
      if (status) return status;
      return Number(b.confidence_pct ?? 0) - Number(a.confidence_pct ?? 0);
    }),
    [contacts.data],
  );

  const channels = new Set(items.map((item) => item.contact_type)).size;
  const verified = items.filter((item) => item.verification_status === 'VERIFICADO').length;
  const target = {
    rut: row.subject.rut,
    name: row.subject.name,
    region: row.subject.region,
    commune: row.subject.commune,
    sector: row.subject.sector,
  };

  async function enrich() {
    setBusy(true);
    setMessage(null);
    setLocalError(null);
    const { data, error } = await supabase.functions.invoke('atlas-candidate-contact-enrichment', {
      body: {
        rut: row.subject.rut,
        entity_id: row.subject.entityId,
        entity_name: row.subject.name,
        trigger_source: 'UNIVERSO_SO',
      },
    });
    setBusy(false);
    if (error) {
      setLocalError(error.message || 'No fue posible completar el barrido de red abierta.');
      return;
    }
    const result = data as EnrichmentResult | null;
    const found = Array.isArray(result?.findings) ? result.findings.length : 0;
    setMessage(found > 0
      ? `Barrido actualizado · ${n(found)} hallazgo${found === 1 ? '' : 's'} recuperado${found === 1 ? '' : 's'}.`
      : 'Barrido actualizado. No aparecieron nuevos datos de contacto con evidencia suficiente.');
    contacts.reload();
  }

  function adopt(contact: OpenContact) {
    const field = FIELD_BY_TYPE[contact.contact_type];
    if (!field) return;
    const source = [contact.source_label, contact.source_url].filter(Boolean).join(' · ');
    const currentSource = row.record.contact.fuente.trim();
    const patch: Partial<CaseContact> = { [field]: contact.contact_value };
    if (source && !currentSource.includes(source)) {
      patch.fuente = currentSource ? `${currentSource} | ${source}` : source;
    }
    const nextState = row.record.state === 'SIN_TRABAJAR' || row.record.state === 'EN_UBICACION'
      ? 'CONTACTO_OBTENIDO'
      : row.record.state;
    onPatch({ contact: patch, state: nextState });
    setMessage(`${TYPE_LABEL[contact.contact_type] ?? 'Dato'} incorporado a Gestión.`);
  }

  async function setStatus(contact: OpenContact, status: 'VERIFICADO' | 'DESCARTADO') {
    setActionId(contact.contact_id);
    setLocalError(null);
    const { error } = await supabase.rpc('aml_candidate_contact_set_status', {
      p_contact_id: contact.contact_id,
      p_status: status,
      p_note: null,
    });
    setActionId(null);
    if (error) {
      setLocalError(error.message);
      return;
    }
    setMessage(status === 'VERIFICADO' ? 'Hallazgo marcado como verificado.' : 'Hallazgo descartado de esta entidad.');
    contacts.reload();
  }

  return (
    <div className="uso-case-body fade-in uso-open-contact">
      <div className="uso-open-head">
        <div>
          <span className="uso-kicker">Contacto abierto</span>
          <h4>Cómo alcanzar a esta entidad</h4>
          <p>Atlas conserva hallazgos de fuentes públicas con origen, fecha y confianza. Revísalos antes de incorporarlos a una gestión.</p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => void enrich()} disabled={busy}>
          {busy ? 'Buscando…' : items.length ? 'Actualizar red abierta' : 'Buscar en red abierta'}
        </button>
      </div>

      <div className="uso-open-stats" aria-label="Cobertura de contacto observado">
        <span><b>{contacts.loading && !contacts.data ? '…' : n(items.length)}</b> hallazgos</span>
        <span><b>{n(channels)}</b> canales</span>
        <span><b>{n(verified)}</b> verificados</span>
        {items[0]?.last_observed_at && <span>observado {dateLabel(items[0].last_observed_at)}</span>}
      </div>

      {(contacts.error || localError) && (
        <div className="uso-open-message uso-open-error">
          {contacts.error ?? localError}
          {contacts.error && <button onClick={contacts.reload}>Reintentar</button>}
        </div>
      )}
      {message && <div className="uso-open-message">{message}</div>}

      {contacts.loading && !contacts.data ? (
        <div className="uso-open-empty">Leyendo contactos observados…</div>
      ) : items.length ? (
        <div className="uso-open-grid">
          {items.map((contact) => {
            const confidence = Number(contact.confidence_pct ?? 0);
            const field = FIELD_BY_TYPE[contact.contact_type];
            const href = directHref(contact);
            const domain = host(contact.source_url);
            return (
              <article className="uso-open-item" key={contact.contact_id} data-status={contact.verification_status ?? 'NO_VERIFICADO'}>
                <span className="uso-open-kind" aria-hidden>{TYPE_GLYPH[contact.contact_type] ?? '·'}</span>
                <div className="uso-open-value">
                  <span>{TYPE_LABEL[contact.contact_type] ?? contact.contact_type}</span>
                  <b>{contact.contact_value}</b>
                  <small>
                    {contact.source_label || domain || 'fuente abierta'}
                    {domain && contact.source_label ? ` · ${domain}` : ''}
                    {' · '}{dateLabel(contact.last_observed_at ?? contact.updated_at)}
                  </small>
                  {contact.evidence_note && <em>{contact.evidence_note}</em>}
                </div>
                <div className="uso-open-quality">
                  <b>{confidence ? `${n1(confidence)}%` : '—'}</b>
                  <span>{STATUS_LABEL[contact.verification_status ?? 'NO_VERIFICADO'] ?? 'No verificado'}</span>
                  {(contact.evidence_count ?? 0) > 1 && <small>{n(contact.evidence_count)} evidencias</small>}
                </div>
                <div className="uso-open-actions">
                  <CopyButton text={contact.contact_value} label="Copiar" done="Copiado" small />
                  {field && <button className="uso-open-use" onClick={() => adopt(contact)}>Usar</button>}
                  {href && <a href={href} target={contact.contact_type === 'WEB' ? '_blank' : undefined} rel="noreferrer">Abrir</a>}
                  {contact.source_url && <a href={contact.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>}
                  {contact.verification_status !== 'VERIFICADO' && (
                    <button disabled={actionId === contact.contact_id} onClick={() => void setStatus(contact, 'VERIFICADO')}>Validar</button>
                  )}
                  <button className="uso-open-discard" disabled={actionId === contact.contact_id} onClick={() => void setStatus(contact, 'DESCARTADO')}>Descartar</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="uso-open-empty">
          <b>Aún no hay contacto guardado para este RUT.</b>
          <span>Ejecuta el barrido sólo cuando vayas a gestionar el caso; Atlas no rastrea entidades en segundo plano.</span>
        </div>
      )}

      <details className="uso-open-manual">
        <summary>Búsqueda manual y fuentes de contraste</summary>
        <div className="uso-open-manual-tools">
          <p>Para contrastar o completar un hallazgo, conserva las consultas dirigidas a registros y buscadores.</p>
          <CopyButton text={locateQueriesText(target)} label="Copiar consultas" done="Consultas copiadas" small />
        </div>
        <div className="uso-open-manual-groups">
          {locateGroups(target).map((group) => (
            <div key={group.id}>
              <b>{group.title}</b>
              <span>{group.purpose}</span>
              <nav>
                {group.links.map((link) => (
                  <a key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>
                ))}
              </nav>
            </div>
          ))}
        </div>
        <p className="uso-note">{LOCATE_LIMIT}</p>
      </details>

      <p className="uso-open-limit">
        Los datos mostrados son observados en fuentes públicas. No acreditan vigencia, representación legal, domicilio oficial ni idoneidad del canal para una notificación formal.
      </p>
    </div>
  );
}
'''

css = r'''/* Universo SO · contacto abierto */
.uso-open-contact { gap: 12px; }

.uso-open-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.uso-open-head h4 {
  margin: 3px 0 0;
  font-size: 16px;
  letter-spacing: -0.02em;
  color: var(--ink);
}

.uso-open-head p {
  max-width: 72ch;
  margin: 5px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-3);
}

.uso-open-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-panel-2);
  color: var(--ink-3);
  font-size: 10.5px;
}

.uso-open-stats b { color: var(--ink); font-size: 12px; }

.uso-open-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--present) 28%, var(--line));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--present) 7%, var(--bg-panel));
  color: var(--ink-2);
  font-size: 11px;
}

.uso-open-error {
  border-color: color-mix(in srgb, var(--sig-high) 35%, var(--line));
  background: color-mix(in srgb, var(--sig-high) 7%, var(--bg-panel));
}

.uso-open-message button {
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.uso-open-grid {
  display: grid;
  gap: 6px;
}

.uso-open-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 78px auto;
  gap: 10px;
  align-items: center;
  min-height: 52px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-panel-2);
}

.uso-open-item[data-status='VERIFICADO'] {
  border-color: color-mix(in srgb, var(--present) 42%, var(--line));
}

.uso-open-kind {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  color: var(--accent);
  font-size: 10px;
  font-weight: 750;
}

.uso-open-value { min-width: 0; }
.uso-open-value > span { display: block; color: var(--ink-4); font-size: 9.5px; }
.uso-open-value > b {
  display: block;
  overflow: hidden;
  margin-top: 1px;
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uso-open-value > small { display: block; overflow: hidden; margin-top: 2px; color: var(--ink-4); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
.uso-open-value > em { display: block; overflow: hidden; margin-top: 2px; color: var(--ink-3); font-size: 9.5px; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }

.uso-open-quality { text-align: right; }
.uso-open-quality b { display: block; color: var(--ink); font-size: 12px; }
.uso-open-quality span, .uso-open-quality small { display: block; color: var(--ink-4); font-size: 9px; }
.uso-open-item[data-status='VERIFICADO'] .uso-open-quality span { color: var(--present); }

.uso-open-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.uso-open-actions > button:not(.copy-btn),
.uso-open-actions > a {
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--ink-3);
  font-size: 9.5px;
  line-height: 1.1;
  text-decoration: none;
  cursor: pointer;
}
.uso-open-actions > button:hover,
.uso-open-actions > a:hover { border-color: var(--line-strong); color: var(--ink); }
.uso-open-actions .uso-open-use { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); color: var(--accent); }
.uso-open-actions .uso-open-discard { color: var(--ink-4); }

.uso-open-empty {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--ink-3);
  font-size: 11px;
}
.uso-open-empty b { color: var(--ink-2); }

.uso-open-manual {
  border-top: 1px solid var(--line);
  padding-top: 9px;
}
.uso-open-manual summary {
  color: var(--ink-3);
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;
}
.uso-open-manual-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 9px;
}
.uso-open-manual-tools p { margin: 0; color: var(--ink-4); font-size: 10px; }
.uso-open-manual-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 8px;
}
.uso-open-manual-groups > div { padding: 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg-panel-2); }
.uso-open-manual-groups b { display: block; color: var(--ink-2); font-size: 10.5px; }
.uso-open-manual-groups span { display: block; margin-top: 2px; color: var(--ink-4); font-size: 9px; line-height: 1.4; }
.uso-open-manual-groups nav { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.uso-open-manual-groups a { padding: 3px 5px; border: 1px solid var(--line); border-radius: 5px; color: var(--ink-3); font-size: 9px; text-decoration: none; }
.uso-open-manual-groups a:hover { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }

.uso-open-limit { margin: 0; color: var(--ink-4); font-size: 9.5px; line-height: 1.45; }

/* La navegación de la ficha se mantiene disponible mientras se revisa una lista larga. */
.uso-case-tabs {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--bg-panel);
  box-shadow: 0 1px 0 var(--line);
}

@media (max-width: 1240px) {
  .uso-open-item { grid-template-columns: 26px minmax(0, 1fr) 68px; }
  .uso-open-actions { grid-column: 2 / -1; justify-content: flex-start; }
}

@media (max-width: 720px) {
  .uso-open-head { flex-direction: column; }
  .uso-open-item { grid-template-columns: 24px minmax(0, 1fr); }
  .uso-open-quality { grid-column: 2; text-align: left; display: flex; gap: 6px; }
  .uso-open-actions { grid-column: 2; }
  .uso-open-manual-groups { grid-template-columns: 1fr; }
}
'''

migration = r'''create or replace function public.obs_uaf_contact_osint(
  p_rut text,
  p_entity_id text default null
)
returns table (
  contact_id uuid,
  contact_type text,
  contact_value text,
  source_label text,
  source_url text,
  confidence_pct numeric,
  verification_status text,
  evidence_note text,
  evidence_count integer,
  source_domains text[],
  last_observed_at timestamptz,
  updated_at timestamptz,
  analyst_note text
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select
    c.contact_id,
    c.contact_type,
    c.contact_value,
    c.source_label,
    c.source_url,
    c.confidence_pct,
    c.verification_status,
    c.evidence_note,
    coalesce(c.evidence_count, 1),
    c.source_domains,
    c.last_observed_at,
    c.updated_at,
    c.analyst_note
  from public.aml_uaf_candidate_contact_osint c
  where
    (
      regexp_replace(upper(coalesce(c.rut, '')), '[^0-9K]', '', 'g') =
      regexp_replace(upper(coalesce(p_rut, '')), '[^0-9K]', '', 'g')
      or (
        nullif(btrim(p_entity_id), '') is not null
        and c.entity_id = p_entity_id
      )
    )
    and coalesce(c.verification_status, 'NO_VERIFICADO') <> 'DESCARTADO'
  order by
    case coalesce(c.verification_status, 'NO_VERIFICADO')
      when 'VERIFICADO' then 0
      when 'PROBABLE' then 1
      else 2
    end,
    c.confidence_pct desc nulls last,
    c.last_observed_at desc nulls last,
    c.updated_at desc
  limit 24;
$$;

comment on function public.obs_uaf_contact_osint(text, text) is
  'Read model de contactos observados en fuentes abiertas para una entidad de Universo SO. Los hallazgos no acreditan vigencia ni representación y excluyen los descartados por analista.';

revoke all on function public.obs_uaf_contact_osint(text, text) from public, anon;
grant execute on function public.obs_uaf_contact_osint(text, text) to authenticated, service_role;

create or replace function public.obs_uaf_contact_osint_coverage(p_ruts text[])
returns table (
  rut_key text,
  finding_count bigint,
  channel_count bigint,
  verified_count bigint,
  probable_count bigint,
  last_observed_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with wanted as (
    select distinct regexp_replace(upper(coalesce(x, '')), '[^0-9K]', '', 'g') as rut_key
    from unnest(coalesce(p_ruts, array[]::text[])) x
    where nullif(regexp_replace(upper(coalesce(x, '')), '[^0-9K]', '', 'g'), '') is not null
  )
  select
    regexp_replace(upper(coalesce(c.rut, '')), '[^0-9K]', '', 'g') as rut_key,
    count(*)::bigint as finding_count,
    count(distinct c.contact_type)::bigint as channel_count,
    count(*) filter (where c.verification_status = 'VERIFICADO')::bigint as verified_count,
    count(*) filter (where c.verification_status = 'PROBABLE')::bigint as probable_count,
    max(c.last_observed_at) as last_observed_at
  from public.aml_uaf_candidate_contact_osint c
  join wanted w
    on w.rut_key = regexp_replace(upper(coalesce(c.rut, '')), '[^0-9K]', '', 'g')
  where coalesce(c.verification_status, 'NO_VERIFICADO') <> 'DESCARTADO'
  group by 1;
$$;

comment on function public.obs_uaf_contact_osint_coverage(text[]) is
  'Cobertura liviana de hallazgos de contacto abierto para las filas visibles de Universo SO.';

revoke all on function public.obs_uaf_contact_osint_coverage(text[]) from public, anon;
grant execute on function public.obs_uaf_contact_osint_coverage(text[]) to authenticated, service_role;
'''

(ROOT / 'src/views/universo/OpenContactPanel.tsx').write_text(component, encoding='utf-8')
(ROOT / 'src/styles/universo-contact.css').write_text(css, encoding='utf-8')
(ROOT / 'supabase/migrations/20260910104500_universo_so_contact_osint_read.sql').write_text(migration, encoding='utf-8')

case_path = ROOT / 'src/views/universo/CaseFile.tsx'
case = case_path.read_text(encoding='utf-8')
case = replace_once(
    case,
    "import { LOCATE_FIRST_PASS, LOCATE_LIMIT, locateGroups, locateQueriesText, rutForms } from '../../lib/osint';",
    "import { rutForms } from '../../lib/osint';",
    'import osint de CaseFile',
)
case = replace_once(
    case,
    "import type { CaseRow } from './model';",
    "import type { CaseRow } from './model';\nimport { OpenContactPanel } from './OpenContactPanel';",
    'import OpenContactPanel',
)
case = replace_once(
    case,
    "const [tab, setTab] = useState<'motivo' | 'ubicar' | 'gestion'>('motivo');",
    "const [tab, setTab] = useState<'motivo' | 'ubicar' | 'gestion'>('ubicar');",
    'tab inicial',
)
case = replace_once(
    case,
    "<button data-on={tab === 'ubicar'} onClick={() => setTab('ubicar')}>Ubicar</button>",
    "<button data-on={tab === 'ubicar'} onClick={() => setTab('ubicar')}>Contacto abierto</button>",
    'nombre del tab',
)
pattern = re.compile(r"\n      \{tab === 'ubicar' && \(\n.*?\n      \)\}\n\n      \{tab === 'gestion' && \(", re.S)
replacement = "\n      {tab === 'ubicar' && (\n        <OpenContactPanel row={row} onPatch={onPatch} />\n      )}\n\n      {tab === 'gestion' && ("
case, count = pattern.subn(replacement, case, count=1)
if count != 1:
    raise SystemExit(f'Bloque Ubicar reemplazado {count} veces')
case_path.write_text(case, encoding='utf-8')

print('Universo SO: contacto abierto integrado')
