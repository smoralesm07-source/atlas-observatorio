import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import { n, n1, rutFormat } from '../lib/format';
import type { UafPulse, UafReportingSector, UafSubjectRow } from '../lib/contracts';

type WatchKind = 'SIN_INSCRITOS' | 'BAJA_REZAGO' | 'SIN_ROS_5Y';

type Pick = {
  sector: UafReportingSector;
  kind: WatchKind;
};

const GROUP_META: Record<WatchKind, { title: string; eyebrow: string; tone: string; note: string }> = {
  SIN_INSCRITOS: {
    title: 'Sectores sin inscritos',
    eyebrow: 'Brecha de padrón',
    tone: 'var(--unknown)',
    note: 'Categorías canónicas de la Ley 19.913 que no tienen sujetos en el corte operativo vigente.',
  },
  BAJA_REZAGO: {
    title: 'Baja reportabilidad o rezago',
    eyebrow: 'Vigilancia sectorial',
    tone: 'var(--sig-medium)',
    note: 'Menos de 1 ROS por cada 100 inscritos en 2025 o al menos dos años completos sin ROS.',
  },
  SIN_ROS_5Y: {
    title: 'Sin ROS en toda la serie',
    eyebrow: 'Silencio 2021–2025',
    tone: 'var(--sig-high)',
    note: 'Sectores con inscritos y cero ROS agregados en cada año de la ventana observada 2021–2025.',
  },
};

function lastRosYear(s: UafReportingSector): number | null {
  if ((s.ros_2025 ?? 0) > 0) return 2025;
  if ((s.ros_2024 ?? 0) > 0) return 2024;
  if ((s.ros_2023 ?? 0) > 0) return 2023;
  if ((s.ros_2022 ?? 0) > 0) return 2022;
  if ((s.ros_2021 ?? 0) > 0) return 2021;
  return null;
}

function subjectCount(s: UafReportingSector): number {
  return s.padron_sujetos ?? s.registered_so_2025 ?? 0;
}

function lowOrStale(s: UafReportingSector): boolean {
  if (!s.sector_canonical || s.silence_5y === true) return false;
  const intensity = s.ros_per_100_so_2025;
  const last = lastRosYear(s);
  const low = intensity != null && intensity < 1;
  const stale = last != null && last <= 2023;
  return low || stale;
}

function rowMetric(s: UafReportingSector, kind: WatchKind): string {
  if (kind === 'SIN_INSCRITOS') return '0 inscritos';
  if (kind === 'SIN_ROS_5Y') return `${n(subjectCount(s))} inscritos · 0 ROS/5 años`;
  const last = lastRosYear(s);
  if (last != null && last <= 2023) return `${n(subjectCount(s))} inscritos · último ROS ${last}`;
  if (s.ros_per_100_so_2025 != null) {
    return `${n(subjectCount(s))} inscritos · ${n1(s.ros_per_100_so_2025)} ROS/100`;
  }
  return `${n(subjectCount(s))} inscritos · baja actividad reportada`;
}

export function UafSectorWatch() {
  const { data, error, loading, reload } = useRpc<UafPulse>('obs_uaf_pulse', {});
  const [pick, setPick] = useState<Pick | null>(null);

  const groups = useMemo(() => {
    const sectors = data?.reporting?.sectores ?? [];
    const sinInscritos = sectors
      .filter((s) => s.sector_canonical == null)
      .sort((a, b) => a.sector_official.localeCompare(b.sector_official, 'es'));
    const sinRos5y = sectors
      .filter((s) => s.sector_canonical != null && s.silence_5y === true)
      .sort((a, b) => subjectCount(b) - subjectCount(a));
    const bajaRezago = sectors
      .filter(lowOrStale)
      .sort((a, b) => {
        const aLast = lastRosYear(a) ?? 9999;
        const bLast = lastRosYear(b) ?? 9999;
        if (aLast !== bLast) return aLast - bLast;
        return (a.ros_per_100_so_2025 ?? Number.POSITIVE_INFINITY)
          - (b.ros_per_100_so_2025 ?? Number.POSITIVE_INFINITY);
      });
    return {
      SIN_INSCRITOS: sinInscritos,
      BAJA_REZAGO: bajaRezago,
      SIN_ROS_5Y: sinRos5y,
    } satisfies Record<WatchKind, UafReportingSector[]>;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="uaf-sector-watch uaf-sector-watch-loading" aria-live="polite">
        <span className="uaf-sector-watch-pulse" />
        Leyendo brechas de padrón y reportabilidad sectorial…
      </div>
    );
  }

  if (error) {
    return (
      <div className="uaf-sector-watch uaf-sector-watch-error">
        <span>No fue posible cargar el monitor sectorial: {error}</span>
        <button type="button" onClick={reload}>Reintentar</button>
      </div>
    );
  }

  if (!data?.reporting?.disponible) return null;

  return (
    <section className="uaf-sector-watch" aria-label="Brechas sectoriales UAF">
      <div className="uaf-sector-watch-head">
        <div>
          <span className="uaf-sector-watch-kicker">Lectura de analista</span>
          <h4>Brechas que conviene abrir después de la conciliación</h4>
          <p>
            Tres lecturas distintas: ausencia de inscritos, baja actividad reportada y silencio
            persistente. Selecciona un sector para revisar los sujetos que componen la señal.
          </p>
        </div>
        <span className="uaf-sector-watch-source">Informe Estadístico UAF · 2021–2025</span>
      </div>

      <div className="uaf-sector-watch-grid">
        {(['SIN_INSCRITOS', 'BAJA_REZAGO', 'SIN_ROS_5Y'] as WatchKind[]).map((kind) => (
          <WatchCard
            key={kind}
            kind={kind}
            rows={groups[kind]}
            onPick={(sector) => setPick({ kind, sector })}
          />
        ))}
      </div>

      {pick && (
        <SectorExplorer
          pick={pick}
          onClose={() => setPick(null)}
        />
      )}

      <p className="uaf-sector-watch-semantic">
        La reportabilidad disponible es agregada por sector. Un sector con pocos o ningún ROS no
        prueba incumplimiento de una entidad: el ROS se remite ante una operación sospechosa y no
        tiene periodicidad mínima. “Sin ROS en toda la serie” significa exclusivamente 2021–2025.
      </p>
    </section>
  );
}

function WatchCard({
  kind,
  rows,
  onPick,
}: {
  kind: WatchKind;
  rows: UafReportingSector[];
  onPick: (sector: UafReportingSector) => void;
}) {
  const meta = GROUP_META[kind];
  const entities = rows.reduce((sum, row) => sum + subjectCount(row), 0);
  const peak = Math.max(1, ...rows.map(subjectCount));

  return (
    <article className="uaf-watch-card" style={{ ['--watch-tone' as string]: meta.tone }}>
      <header>
        <div>
          <span>{meta.eyebrow}</span>
          <h5>{meta.title}</h5>
        </div>
        <strong className="num">{n(rows.length)}</strong>
      </header>
      <p>{meta.note}</p>
      <div className="uaf-watch-summary">
        <span>{kind === 'SIN_INSCRITOS' ? 'sectores' : `${n(entities)} sujetos detrás`}</span>
        <i><b style={{ width: `${Math.min(100, Math.max(8, rows.length * 8))}%` }} /></i>
      </div>
      <div className="uaf-watch-rows">
        {rows.length === 0 ? (
          <div className="uaf-watch-empty">Sin sectores bajo este criterio en el corte vigente.</div>
        ) : rows.slice(0, 10).map((s) => {
          const count = subjectCount(s);
          const width = kind === 'SIN_INSCRITOS' ? 0 : Math.max(3, (count / peak) * 100);
          return (
            <button
              type="button"
              className="uaf-watch-row"
              key={s.sector_official}
              onClick={() => onPick(s)}
              title="Abrir detalle del sector"
            >
              <span className="uaf-watch-row-label">{s.etiqueta || s.sector_official}</span>
              <span className="uaf-watch-row-metric">{rowMetric(s, kind)}</span>
              <span className="uaf-watch-row-track" aria-hidden>
                <b style={{ width: `${width}%` }} />
              </span>
              <span className="uaf-watch-row-arrow">→</span>
            </button>
          );
        })}
      </div>
      {rows.length > 10 && (
        <div className="uaf-watch-more">+ {n(rows.length - 10)} sectores adicionales bajo el mismo criterio</div>
      )}
    </article>
  );
}

function SectorExplorer({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const { sector, kind } = pick;
  const canonical = sector.sector_canonical;
  const [limit, setLimit] = useState(40);
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useRpc<UafSubjectRow[]>(
    'obs_uaf_cohort',
    {
      p_cohort: 'SECTOR',
      p_value: canonical,
      p_limit: limit,
      p_offset: 0,
    },
    { skip: !canonical },
  );

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es');
    if (!q) return data ?? [];
    return (data ?? []).filter((s) =>
      s.name.toLocaleLowerCase('es').includes(q)
      || s.rut.toLocaleLowerCase('es').includes(q)
      || (s.region ?? '').toLocaleLowerCase('es').includes(q)
      || (s.commune ?? '').toLocaleLowerCase('es').includes(q),
    );
  }, [data, query]);

  const total = data?.[0]?.total_count ?? subjectCount(sector);
  const meta = GROUP_META[kind];

  return (
    <div className="uaf-sector-explorer" style={{ ['--watch-tone' as string]: meta.tone }}>
      <header>
        <div>
          <span>{meta.eyebrow}</span>
          <h5>{sector.etiqueta || sector.sector_official}</h5>
          <p>{rowMetric(sector, kind)}</p>
        </div>
        <button type="button" className="uaf-sector-explorer-close" onClick={onClose} aria-label="Cerrar detalle">×</button>
      </header>

      {!canonical ? (
        <div className="uaf-sector-explorer-empty">
          <strong>No hay entidades inscritas que desplegar.</strong>
          <span>
            Esta señal existe precisamente porque la categoría no tiene sujetos en el corte del
            padrón UAF. Debe leerse como vacío registral observable, no como prueba de incumplimiento.
          </span>
        </div>
      ) : error ? (
        <div className="uaf-sector-explorer-empty">
          <strong>No se pudo abrir la cohorte.</strong>
          <span>{error}</span>
          <button type="button" onClick={reload}>Reintentar</button>
        </div>
      ) : (
        <>
          <div className="uaf-sector-explorer-tools">
            <label>
              <span>Buscar dentro de lo cargado</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre, RUT, región o comuna"
              />
            </label>
            <div>
              <strong className="num">{loading && !data ? '…' : n(total)}</strong>
              <span>sujetos del sector</span>
            </div>
          </div>

          {loading && !data ? (
            <div className="uaf-sector-explorer-empty">Cargando entidades del sector…</div>
          ) : rows.length === 0 ? (
            <div className="uaf-sector-explorer-empty">No hay coincidencias con el filtro actual.</div>
          ) : (
            <div className="uaf-sector-entity-list">
              {rows.map((s) => (
                <div className="uaf-sector-entity" key={s.rut}>
                  <div>
                    <strong>{s.name}</strong>
                    <span>{rutFormat(s.rut)} · {[s.commune, s.region].filter(Boolean).join(' · ') || 'sin territorio observado'}</span>
                  </div>
                  <div className="uaf-sector-entity-state">
                    <span>{s.sii_status === 'TERMINATED_AS_PUBLISHED' ? 'Término de giro' : s.sii_status === 'ACTIVE_AS_PUBLISHED' ? 'Activo SII' : 'Sin perfil SII'}</span>
                    {s.ipf_score != null && <b className="num">IPF {n1(s.ipf_score)}</b>}
                    {s.entity_id && (
                      <a href={hrefFor({ view: 'ficha', entityId: s.entity_id })}>Ficha 360 →</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!query && (data?.length ?? 0) < total && (
            <div className="uaf-sector-explorer-more">
              <button type="button" onClick={() => setLimit((v) => Math.min(200, v + 40))} disabled={limit >= 200}>
                {limit >= 200 ? 'Máximo de 200 en pantalla' : `Cargar más · ${n(total - (data?.length ?? 0))} restantes`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
