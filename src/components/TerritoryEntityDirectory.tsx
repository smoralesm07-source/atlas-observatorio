import type { TerritoryDetail } from '../lib/contracts';
import { hrefFor } from '../lib/router';
import { n, n1, rutFormat, titleCase } from '../lib/format';
import '../styles/subject-directory.css';
import '../styles/territory-entity-directory.css';

type BaseTerritoryEntity = TerritoryDetail['entidades'][number];

type TerritoryEntity = BaseTerritoryEntity & {
  region?: string | null;
  commune?: string | null;
  is_osfl?: boolean;
  is_state_supplier?: boolean;
  sanction_count?: number;
  has_press?: boolean;
  press_evidence_count?: number;
  sii_status?: string | null;
  sii_termination_date?: string | null;
  main_activity?: string | null;
  economic_sector?: string | null;
  priority_score?: number | null;
  priority_band?: string | null;
  priority_metric?: 'IPF' | 'IPA' | string | null;
  attention_motive?: string | null;
};

export function TerritoryEntityDirectory({
  rows,
  region,
  commune,
  onNavigate,
}: {
  rows: TerritoryEntity[];
  region: string;
  commune: string;
  onNavigate: (hash: string) => void;
}) {
  return (
    <div className="subject-directory-scroll territory-entity-directory" data-territory-directory="true">
      <table className="subject-directory-table">
        <thead>
          <tr>
            <th>Entidad</th>
            <th>Sector UAF</th>
            <th>Situación SII</th>
            <th>Región</th>
            <th>Marcas</th>
            <th>Prioridad</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const score = row.priority_score ?? row.ipa3_score;
            const band = row.priority_band ?? null;
            const metric = row.priority_metric ?? (row.is_uaf_observed ? 'IPF' : 'IPA');
            const sanctions = Math.max(row.sanction_count ?? 0, row.is_sanctioned ? 1 : 0);
            return (
              <tr
                key={row.entity_id}
                data-territory-entity="true"
                data-sector={normalizeFilterValue(row.uaf_sector)}
                data-uaf={row.is_uaf_observed ? 'true' : 'false'}
                data-sanction={sanctions > 0 ? 'true' : 'false'}
                data-alert={row.alert_count > 0 ? 'true' : 'false'}
                data-finding={row.finding_count > 0 ? 'true' : 'false'}
              >
                <td className="subject-directory-entity">
                  <b>{titleCase(row.name)}</b>
                  <span>
                    {row.rut ? rutFormat(row.rut) : 'sin RUT'} ·{' '}
                    {row.main_activity ? titleCase(row.main_activity) : row.entity_type ? titleCase(row.entity_type) : 'sin actividad principal observada'}
                  </span>
                </td>
                <td>
                  <div className="subject-directory-main">
                    {row.uaf_sector ? titleCase(row.uaf_sector) : 'Sin sector UAF observado'}
                  </div>
                  {row.economic_sector && (
                    <span className="subject-directory-secondary">{titleCase(row.economic_sector)}</span>
                  )}
                </td>
                <td>
                  <span
                    className="subject-directory-state"
                    style={{ ['--state-tone' as string]: stateTone(row.sii_status) }}
                  >
                    <i />{stateLabel(row.sii_status)}
                  </span>
                  {row.sii_termination_date && (
                    <span className="subject-directory-secondary">Término {row.sii_termination_date.slice(0, 10)}</span>
                  )}
                </td>
                <td className="subject-directory-region">
                  <div className="subject-directory-main">{row.region ? titleCase(row.region) : titleCase(region)}</div>
                  <span className="subject-directory-secondary">{row.commune ? titleCase(row.commune) : titleCase(commune)}</span>
                </td>
                <td><TerritorySignals row={row} /></td>
                <td className="subject-directory-score">
                  <b>{score == null ? '—' : n1(score)}</b>
                  <small>{metric}{band ? ` · ${titleCase(band.replace(/_/g, ' '))}` : ''}</small>
                </td>
                <td>
                  <div className="subject-directory-actions">
                    <button
                      type="button"
                      className="subject-directory-open territory-directory-open"
                      onClick={() => onNavigate(hrefFor({ view: 'ficha', entityId: row.entity_id }))}
                    >
                      Entidad 360 →
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TerritorySignals({ row }: { row: TerritoryEntity }) {
  const sanctions = Math.max(row.sanction_count ?? 0, row.is_sanctioned ? 1 : 0);
  const press = row.press_evidence_count ?? 0;
  const hasAny = row.is_uaf_observed || row.is_osfl || sanctions > 0 || row.has_press || press > 0
    || row.is_state_supplier || row.alert_count > 0 || row.finding_count > 0 || Boolean(row.attention_motive);

  if (!hasAny) {
    return <span className="subject-directory-secondary">sin marca en estos cruces</span>;
  }

  return (
    <div className="subject-directory-signals">
      {row.is_uaf_observed && <span className="subject-directory-signal" data-kind="uaf">SO UAF</span>}
      {row.is_osfl && <span className="subject-directory-signal" data-kind="osfl">OSFL</span>}
      {sanctions > 0 && (
        <span className="subject-directory-signal" data-kind="sanction">Sanción · {n(sanctions)}</span>
      )}
      {(row.has_press || press > 0) && (
        <span className="subject-directory-signal" data-kind="press">Prensa{press > 0 ? ` · ${n(press)}` : ''}</span>
      )}
      {row.is_state_supplier && (
        <span className="subject-directory-signal" data-kind="provider">Proveedor Estado</span>
      )}
      {row.alert_count > 0 && (
        <span className="subject-directory-signal" data-kind="alert">Señal · {n(row.alert_count)}</span>
      )}
      {row.finding_count > 0 && (
        <span className="subject-directory-signal" data-kind="finding">Hallazgo · {n(row.finding_count)}</span>
      )}
      {row.attention_motive && (
        <span className="subject-directory-signal" data-kind="attention" title={attentionLabel(row.attention_motive)}>
          {attentionLabel(row.attention_motive)}
        </span>
      )}
    </div>
  );
}

function normalizeFilterValue(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

function stateLabel(status: string | null | undefined) {
  if (status === 'ACTIVE_AS_PUBLISHED') return 'Activo ante el SII';
  if (status === 'TERMINATED_AS_PUBLISHED') return 'Término de giro';
  if (status === 'SIN_PERFIL_SII') return 'Sin perfil SII';
  return status ? titleCase(status.replace(/_/g, ' ')) : 'Estado no observado';
}

function stateTone(status: string | null | undefined) {
  if (status === 'ACTIVE_AS_PUBLISHED') return 'var(--present)';
  if (status === 'TERMINATED_AS_PUBLISHED') return 'var(--sig-high)';
  return 'var(--unknown)';
}

function attentionLabel(motive: string) {
  const labels: Record<string, string> = {
    GIRO_ATIPICO: 'Giro atípico',
    TERMINO_GIRO: 'Término de giro',
    IPF_ALTA: 'IPF alto',
    SANCION_HISTORICA: 'Sanción histórica',
    SANCION_RECIENTE: 'Sanción reciente',
    SECTOR_SIN_ROS: 'Sector sin ROS',
    SIN_TERRITORIO: 'Sin territorio',
  };
  return labels[motive] ?? titleCase(motive.replace(/_/g, ' '));
}
