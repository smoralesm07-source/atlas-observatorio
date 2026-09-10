import { useMemo, useState } from 'react';
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

type ContactPreview = { title: string | null; excerpt: string; source_url: string | null; fetched: boolean };

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

const isReliable = (contact: OpenContact) =>
  contact.verification_status === 'VERIFICADO'
  || (contact.verification_status === 'PROBABLE'
    && Number(contact.confidence_pct ?? 0) >= 85
    && Number(contact.evidence_count ?? 0) >= 2);

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
  readOnly = false,
}: {
  row: CaseRow;
  onPatch: (patch: Partial<Pick<CaseRecord, 'state' | 'priority' | 'note'>> & { contact?: Partial<CaseContact> }) => void;
  readOnly?: boolean;
}) {
  const contacts = useRpc<OpenContact[]>('obs_uaf_contact_osint', {
    p_rut: row.subject.rut,
    p_entity_id: row.subject.entityId,
  });
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, ContactPreview | 'loading'>>({});

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
  const recommended = items.find((item) => isReliable(item) && ['TELEFONO', 'EMAIL', 'DIRECCION'].includes(item.contact_type))
    ?? items.find(isReliable)
    ?? null;
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
    if (!isReliable(contact)) {
      setMessage('Valida este hallazgo o confirma evidencia suficiente antes de usarlo como medio de contacto.');
      return;
    }
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

  async function loadPreview(contact: OpenContact) {
    const current = previews[contact.contact_id];
    if (current && current !== 'loading') {
      setPreviews((all) => {
        const next = { ...all };
        delete next[contact.contact_id];
        return next;
      });
      return;
    }
    setPreviews((all) => ({ ...all, [contact.contact_id]: 'loading' }));
    const { data, error } = await supabase.functions.invoke<ContactPreview>('atlas-contact-preview', {
      body: { contact_id: contact.contact_id },
    });
    if (error || !data) {
      setPreviews((all) => ({
        ...all,
        [contact.contact_id]: {
          title: contact.source_label,
          excerpt: contact.evidence_note || 'No fue posible leer una muestra de la fuente en este momento.',
          source_url: contact.source_url,
          fetched: false,
        },
      }));
      return;
    }
    setPreviews((all) => ({ ...all, [contact.contact_id]: data }));
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
          <p>Atlas conserva hallazgos de fuentes públicas con origen, fecha y confianza. Abre «Ver muestra» para evaluarlos dentro de la app antes de incorporarlos.</p>
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

      {recommended && (() => {
        const field = FIELD_BY_TYPE[recommended.contact_type];
        const selected = Boolean(field && row.record.contact[field] === recommended.contact_value);
        return (
          <div className="uso-open-primary" data-selected={selected ? 'true' : undefined}>
            <span className="uso-open-primary-glyph" aria-hidden>{TYPE_GLYPH[recommended.contact_type] ?? '·'}</span>
            <div>
              <span className="uso-kicker">Dato confiable disponible</span>
              <b>{TYPE_LABEL[recommended.contact_type] ?? recommended.contact_type}: {recommended.contact_value}</b>
              <em>{recommended.source_label || host(recommended.source_url) || 'fuente abierta'} · {STATUS_LABEL[recommended.verification_status ?? 'NO_VERIFICADO'] ?? 'No verificado'} · {n1(Number(recommended.confidence_pct ?? 0))}% confianza</em>
            </div>
            {field && !readOnly && (
              <button className="btn btn-sm btn-primary" disabled={selected} onClick={() => adopt(recommended)}>
                {selected ? 'Medio seleccionado' : 'Usar como medio de contacto'}
              </button>
            )}
          </div>
        );
      })()}

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
            const preview = previews[contact.contact_id];
            const reliable = isReliable(contact);
            const selected = Boolean(field && row.record.contact[field] === contact.contact_value);
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
                  <div className="uso-open-preview">
                    <button onClick={() => void loadPreview(contact)}>
                      {preview ? (preview === 'loading' ? 'Leyendo muestra…' : 'Ocultar muestra') : 'Ver muestra del hallazgo'}
                    </button>
                    {preview && preview !== 'loading' && (
                      <div className="uso-open-preview-body">
                        {preview.title && <b>{preview.title}</b>}
                        <p>{preview.excerpt}</p>
                        <small>{preview.fetched ? 'Texto leído desde la fuente' : 'Muestra disponible en Atlas / fuente no legible automáticamente'}</small>
                      </div>
                    )}
                  </div>
                </div>
                <div className="uso-open-quality">
                  <b>{confidence ? `${n1(confidence)}%` : '—'}</b>
                  <span>{STATUS_LABEL[contact.verification_status ?? 'NO_VERIFICADO'] ?? 'No verificado'}</span>
                  {(contact.evidence_count ?? 0) > 1 && <small>{n(contact.evidence_count)} evidencias</small>}
                </div>
                <div className="uso-open-actions">
                  <CopyButton text={contact.contact_value} label="Copiar" done="Copiado" small />
                  {field && !readOnly && (
                    <button
                      className="uso-open-use"
                      data-reliable={reliable ? 'true' : undefined}
                      disabled={!reliable || selected}
                      title={!reliable ? 'Valida el hallazgo o exige al menos 85% de confianza con dos evidencias' : undefined}
                      onClick={() => adopt(contact)}
                    >
                      {selected ? 'Seleccionado' : 'Usar como contacto'}
                    </button>
                  )}
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
