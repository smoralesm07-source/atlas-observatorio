import { useMemo, useState } from 'react';
import { useRpc } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import type { CaseContact, CasePatch } from '../../lib/casework';
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

type EnrichmentResult = { findings?: unknown[] };
type ContactField = keyof Pick<CaseContact, 'telefono' | 'correo' | 'sitio' | 'direccion'>;

type Channel = {
  type: string;
  field: ContactField;
  label: string;
  glyph: string;
};

const CHANNELS: Channel[] = [
  { type: 'DIRECCION', field: 'direccion', label: 'Dirección', glyph: 'D' },
  { type: 'EMAIL', field: 'correo', label: 'Correo electrónico', glyph: '@' },
  { type: 'WEB', field: 'sitio', label: 'Sitio web', glyph: 'W' },
  { type: 'TELEFONO', field: 'telefono', label: 'Teléfono', glyph: 'T' },
];

const statusRank = (status: string | null) => status === 'VERIFICADO' ? 3 : status === 'PROBABLE' ? 2 : 1;
const isReliable = (contact: OpenContact) =>
  contact.verification_status === 'VERIFICADO'
  || (contact.verification_status === 'PROBABLE'
    && Number(contact.confidence_pct ?? 0) >= 85
    && Number(contact.evidence_count ?? 0) >= 2);

/**
 * Algunos buscadores exponen direcciones técnicas propias dentro del HTML o de
 * fragmentos indexados. No son canales de contacto de la entidad y, al repetirse
 * transversalmente, contaminan toda la cola de Gestión SO. Las descartamos antes
 * de ordenar o calcular el mejor hallazgo para que tampoco puedan aparecer como
 * alternativa ni ser adoptadas por el analista.
 */
function isSuppressedContact(contact: OpenContact): boolean {
  if (contact.contact_type !== 'EMAIL') return false;
  const value = contact.contact_value.trim().toLowerCase();
  return value.endsWith('@duckduckgo.com');
}

function host(url: string | null): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function directHref(contact: OpenContact): string | null {
  if (contact.contact_type === 'EMAIL') return `mailto:${contact.contact_value}`;
  if (contact.contact_type === 'TELEFONO') return `tel:${contact.contact_value.replace(/\s+/g, '')}`;
  if (contact.contact_type === 'WEB') return /^https?:\/\//i.test(contact.contact_value) ? contact.contact_value : `https://${contact.contact_value}`;
  return null;
}

export function OpenContactPanel({
  row,
  onPatch,
  readOnly = false,
}: {
  row: CaseRow;
  onPatch: (patch: CasePatch) => void;
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

  const items = useMemo(
    () => (contacts.data ?? [])
      .filter((contact) => !isSuppressedContact(contact))
      .slice()
      .sort((a, b) => {
        const status = statusRank(b.verification_status) - statusRank(a.verification_status);
        if (status) return status;
        return Number(b.confidence_pct ?? 0) - Number(a.confidence_pct ?? 0);
      }),
    [contacts.data],
  );

  const bestByChannel = useMemo(() => CHANNELS.map((channel) => ({
    channel,
    best: items.find((item) => item.contact_type === channel.type && isReliable(item)) ?? null,
    alternatives: items.filter((item) => item.contact_type === channel.type),
  })), [items]);

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
    setMessage(found
      ? `Búsqueda actualizada · ${n(found)} hallazgo${found === 1 ? '' : 's'} recuperado${found === 1 ? '' : 's'}.`
      : 'Búsqueda actualizada. No aparecieron nuevos datos con evidencia suficiente.');
    contacts.reload();
  }

  function adopt(contact: OpenContact, field: ContactField) {
    if (!isReliable(contact)) {
      setMessage('Este dato todavía requiere validación antes de poder incorporarlo.');
      return;
    }
    const source = [contact.source_label, contact.source_url].filter(Boolean).join(' · ');
    const currentSource = row.record.contact.fuente.trim();
    const patch: Partial<CaseContact> = { [field]: contact.contact_value };
    if (source && !currentSource.includes(source)) {
      patch.fuente = currentSource ? `${currentSource} | ${source}` : source;
    }
    onPatch({ contact: patch, noContact: false });
    setMessage('Dato incorporado al campo correspondiente. El estado del caso no cambia hasta que decidas avanzar.');
  }

  async function validate(contact: OpenContact) {
    setActionId(contact.contact_id);
    setLocalError(null);
    const { error } = await supabase.rpc('aml_candidate_contact_set_status', {
      p_contact_id: contact.contact_id,
      p_status: 'VERIFICADO',
      p_note: null,
    });
    setActionId(null);
    if (error) {
      setLocalError(error.message);
      return;
    }
    setMessage('Hallazgo marcado como verificado. Ya puede incorporarse a la gestión.');
    contacts.reload();
  }

  return (
    <div className="uso-case-body uso-open-contact">
      <div className="uso-open-head uso-open-head-compact">
        <div>
          <span className="uso-kicker">Precarga opcional</span>
          <h4>Búsqueda de contacto en red abierta</h4>
          <p>Atlas propone sólo datos con evidencia suficiente. El analista decide qué incorporar.</p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => void enrich()} disabled={busy || readOnly}>
          {busy ? 'Buscando…' : items.length ? 'Actualizar búsqueda' : 'Buscar en red abierta'}
        </button>
      </div>

      {(contacts.error || localError) && (
        <div className="uso-open-message uso-open-error">
          {contacts.error ?? localError}
          {contacts.error && <button onClick={contacts.reload}>Reintentar</button>}
        </div>
      )}
      {message && <div className="uso-open-message">{message}</div>}

      {contacts.loading && !contacts.data ? (
        <div className="uso-open-empty">Leyendo fuentes abiertas…</div>
      ) : (
        <div className="uso-open-grid uso-open-channel-grid">
          {bestByChannel.map(({ channel, best, alternatives }) => {
            const selected = best && row.record.contact[channel.field] === best.contact_value;
            return (
              <article className="uso-open-item uso-open-channel" key={channel.type} data-status={best?.verification_status ?? 'NO_VERIFICADO'}>
                <span className="uso-open-kind" aria-hidden>{channel.glyph}</span>
                <div className="uso-open-value">
                  <span>{channel.label}</span>
                  {best ? (
                    <>
                      <b>{best.contact_value}</b>
                      <small>
                        {best.source_label || host(best.source_url) || 'fuente abierta'} · {n1(Number(best.confidence_pct ?? 0))}% confianza
                      </small>
                      {best.evidence_note && <em>{best.evidence_note}</em>}
                    </>
                  ) : (
                    <>
                      <b>Sin propuesta de alta confianza</b>
                      <small>{alternatives.length ? `${n(alternatives.length)} hallazgo(s) requieren validación` : 'Sin hallazgos observados'}</small>
                    </>
                  )}
                </div>
                <div className="uso-open-row-actions">
                  {best && (
                    <>
                      <CopyButton text={best.contact_value} label="Copiar" done="Copiado" small />
                      {!readOnly && (
                        <button className="uso-open-use" disabled={Boolean(selected)} onClick={() => adopt(best, channel.field)}>
                          {selected ? 'Seleccionado' : `Usar ${channel.label.toLowerCase()}`}
                        </button>
                      )}
                      {directHref(best) && <a href={directHref(best) as string} target="_blank" rel="noreferrer">Abrir</a>}
                      {best.source_url && <a href={best.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>}
                    </>
                  )}
                  {!best && alternatives[0] && !readOnly && (
                    <button disabled={actionId === alternatives[0].contact_id} onClick={() => void validate(alternatives[0])}>
                      Validar mejor hallazgo
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {items.length > 0 && (
        <details className="uso-open-more">
          <summary><span>Todos los hallazgos y evidencia</span><b>{n(items.length)}</b></summary>
          <div className="uso-open-grid">
            {items.map((contact) => {
              const channel = CHANNELS.find((item) => item.type === contact.contact_type);
              const reliable = isReliable(contact);
              return (
                <article className="uso-open-item" key={contact.contact_id} data-status={contact.verification_status ?? 'NO_VERIFICADO'}>
                  <span className="uso-open-kind" aria-hidden>{channel?.glyph ?? '·'}</span>
                  <div className="uso-open-value">
                    <span>{channel?.label ?? contact.contact_type}</span>
                    <b>{contact.contact_value}</b>
                    <small>{contact.source_label || host(contact.source_url) || 'fuente abierta'} · {n1(Number(contact.confidence_pct ?? 0))}%</small>
                    {contact.evidence_note && <em>{contact.evidence_note}</em>}
                  </div>
                  <div className="uso-open-row-actions">
                    {reliable && channel && !readOnly && (
                      <button className="uso-open-use" onClick={() => adopt(contact, channel.field)}>Usar dato</button>
                    )}
                    {!reliable && !readOnly && (
                      <button disabled={actionId === contact.contact_id} onClick={() => void validate(contact)}>Validar</button>
                    )}
                    {contact.source_url && <a href={contact.source_url} target="_blank" rel="noreferrer">Fuente ↗</a>}
                  </div>
                </article>
              );
            })}
          </div>
        </details>
      )}

      <details className="uso-open-manual">
        <summary>Búsqueda manual y fuentes de contraste</summary>
        <div className="uso-open-manual-tools">
          <p>Úsala cuando el barrido automático no entregue un dato suficiente o quieras contrastarlo.</p>
          <CopyButton text={locateQueriesText(target)} label="Copiar consultas" done="Consultas copiadas" small />
        </div>
        <div className="uso-open-manual-groups">
          {locateGroups(target).map((group) => (
            <div key={group.id}>
              <b>{group.title}</b>
              <span>{group.purpose}</span>
              <nav>
                {group.links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>)}
              </nav>
            </div>
          ))}
        </div>
        <p className="uso-note">{LOCATE_LIMIT}</p>
      </details>

      <p className="uso-open-limit">Los datos provienen de fuentes públicas. Atlas prioriza evidencia, pero la decisión de incorporarlos siempre corresponde al analista.</p>
    </div>
  );
}
