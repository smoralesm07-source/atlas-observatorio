import { n } from '../lib/format';
import { Empty } from './primitives';
import type { UafReportingSector } from '../lib/contracts';

export interface SectorGroupRequest {
  id: string;
  title: string;
  color: string;
  note: string;
  sectors: UafReportingSector[];
  metric: (s: UafReportingSector) => string;
}

/* Ficha de grupo: al pinchar un cuadro de screening, esto lista los sectores
   que lo componen, uno por uno. Un sector sin inscritos no tiene sujetos que
   abrir —se muestra igual, pero sin flecha ni acción—; un sector con inscritos
   sí se pincha y pasa a la ficha de sujetos del cohorte. */
export function SectorGroupDrawer({
  request,
  onClose,
  onSectorPick,
}: {
  request: SectorGroupRequest;
  onClose: () => void;
  onSectorPick: (sector: string, title: string) => void;
}) {
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={request.title.replace(/\n/g, ' ')}>
        <header className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i
                aria-hidden
                style={{
                  width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                  background: request.color,
                }}
              />
              {request.title.replace(/\n/g, ' ')}
            </h2>
            <p>
              {n(request.sectors.length)} sector{request.sectors.length === 1 ? '' : 'es'} · {request.note}
            </p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="drawer-body">
          {request.sectors.length === 0 ? (
            <Empty title="Sin sectores" hint="Ningún sector obligado cumple esta condición en el corte vigente." />
          ) : (
            <div className="sector-group-list">
              {request.sectors.map((s) => {
                const clickable = !!s.sector_canonical;
                const label = s.etiqueta || s.sector_official;
                return (
                  <button
                    key={s.sector_official}
                    type="button"
                    className="sector-group-row"
                    disabled={!clickable}
                    title={clickable ? 'Ver inscritos del sector' : 'Sin sujetos que abrir: el sector no tiene inscritos'}
                    onClick={() => clickable && onSectorPick(s.sector_canonical as string, label)}
                  >
                    <span className="sector-group-row-label">{label}</span>
                    <span className="sector-group-row-metric num">{request.metric(s)}</span>
                    {clickable && <span className="sector-group-row-arrow" aria-hidden>→</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
