import { StatusBadge } from '../components/StatusBadge';
import { LEGAL_LABEL, instant, n } from '../format';
import type { Snapshot } from '../types';

export function Fuentes({ snap }: { snap: Snapshot }) {
  return (
    <div className="view">
      <p className="semantics">
        Cada fuente declara su autoridad, lo que <b>no</b> hace y su nivel de riesgo legal. Una fuente que no respondió
        o que no se consultó nunca se presenta como una fuente que no encontró nada.
      </p>
      <div className="table-wrap">
        <table className="sources">
          <thead>
            <tr><th>Fuente</th><th>Estado</th><th>Registros</th><th>Riesgo legal</th><th>Qué es · qué no hace</th></tr>
          </thead>
          <tbody>
            {snap.sources.map((s) => (
              <tr key={s.code}>
                <td>
                  <strong>{s.name}</strong>
                  <small>{snap.economies[s.economy]?.label}</small>
                  <small className="mono">{s.code}</small>
                </td>
                <td>
                  <StatusBadge status={s.status} />
                  <small>{instant(s.consulted_at)}</small>
                  {s.error && <small className="err">{s.error}</small>}
                  {s.note && <small>{s.note}</small>}
                </td>
                <td className="mono">
                  {s.status === 'NOT_CONSULTED' ? '—' : <>{n(s.records_kept)}<small>de {n(s.records_in)} leídos</small></>}
                </td>
                <td><span className={`legal legal-${s.legal}`}>{LEGAL_LABEL[s.legal]}</span></td>
                <td>
                  {s.authority}
                  <small>{s.does_not}</small>
                  {s.content_sha256 && <small className="mono" title="Huella del contenido leído en este corte">sha256 {s.content_sha256.slice(0, 16)}…</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
