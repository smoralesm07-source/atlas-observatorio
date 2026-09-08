import { useMemo, useState } from 'react';
import { n, titleCase } from '../lib/format';
import type { UafReportingSector } from '../lib/contracts';

interface SectorCategory {
  id: 'sin_inscritos' | 'silenciosos' | 'poco_reportan';
  title: string;
  description: string;
  icon: React.ReactNode;
  sectores: UafReportingSector[];
  stat: { label: string; value: string; hint: string };
}

export function SectorHealthBox({
  sectores,
  sectoresBase,
  onSectorPick,
}: {
  sectores: UafReportingSector[];
  sectoresBase: {
    silenciosos: number;
    sin_inscritos: number;
    sujetos_silencio: number;
  };
  onSectorPick?: (sector: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});

  /* Clasificar sectores en tres categorías */
  const categories = useMemo((): SectorCategory[] => {
    /* Sin inscritos: sectores canonicos con padron_sujetos = 0 */
    const sinInscritos = sectores.filter((s) => (s.padron_sujetos ?? 0) === 0);

    /* Silenciosos: sectores con silence_5y = true (inscritos pero sin ROS 2021-2025) */
    const silenciosos = sectores.filter((s) => s.silence_5y === true);

    /* Poco reportan: sectores con muy baja intensidad (ROS per 100 SO < 1) */
    const pocoReportan = sectores.filter((s) => {
      const intensidad = s.ros_per_100_so_2025 ?? 0;
      return intensidad > 0 && intensidad < 1 && !silenciosos.includes(s) && (s.padron_sujetos ?? 0) > 0;
    });

    return [
      {
        id: 'sin_inscritos',
        title: 'Sectores sin inscriptos',
        description: 'Sectores económicos de la Ley 19.913 que no registran ningún inscrito en el padrón UAF',
        icon: '⊘',
        sectores: sinInscritos,
        stat: {
          label: 'Sectores canónicos',
          value: n(sinInscritos.length),
          hint: 'la UAF no tiene registros aquí',
        },
      },
      {
        id: 'silenciosos',
        title: 'Sectores sin reporte histórico',
        description: 'Sectores que no registran ningún ROS entre 2021 y 2025, aunque tienen inscriptos',
        icon: '◯',
        sectores: silenciosos,
        stat: {
          label: 'Con sujetos en silencio',
          value: n(silenciosos.length),
          hint: `${n(sectoresBase.sujetos_silencio)} inscritos sin reporte`,
        },
      },
      {
        id: 'poco_reportan',
        title: 'Sectores con baja reportabilidad',
        description: 'Sectores cuya intensidad de reporte es mínima (menos de 1 ROS por cada 100 inscritos)',
        icon: '↓',
        sectores: pocoReportan,
        stat: {
          label: 'Sectores débiles',
          value: n(pocoReportan.length),
          hint: 'baja intensidad de reportes',
        },
      },
    ];
  }, [sectores, sectoresBase]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="sector-health">
      <div className="health-intro">
        <p>
          El padrón UAF cubre solo una parte de los sectores alcanzados por la Ley 19.913.
          Estos cuadros resumen el estado de cobertura y reporte por sector económico.
        </p>
      </div>

      <div className="health-boxes">
        {categories.map((cat) => (
          <div key={cat.id} className="health-box">
            <div className="health-box-head">
              <span className="health-icon">{cat.icon}</span>
              <div className="health-box-title">
                <h4>{cat.title}</h4>
                <p>{cat.description}</p>
              </div>
            </div>

            <div className="health-stat">
              <span className="health-stat-label">{cat.stat.label}</span>
              <span className="health-stat-value num">{cat.stat.value}</span>
              <span className="health-stat-hint">{cat.stat.hint}</span>
            </div>

            {cat.sectores.length > 0 && (
              <div className="health-explore">
                <button
                  className="health-explore-btn"
                  onClick={() => toggleExpanded(cat.id)}
                  aria-expanded={expanded[cat.id] ?? false}
                >
                  {expanded[cat.id] ? '▼ Ocultar lista' : '▶ Ver lista completa'}
                </button>

                {expanded[cat.id] && (
                  <div className="health-list">
                    <div className="health-list-head">
                      <span style={{ fontSize: 10.5, fontWeight: 650, textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                        Sector obligado
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 650, textTransform: 'uppercase', color: 'var(--ink-3)', textAlign: 'right' }}>
                        {cat.id === 'sin_inscritos' ? 'Universo SII' : 'ROS 2025'}
                      </span>
                    </div>

                    {cat.sectores.slice(0, 20).map((s) => {
                      if (!s.sector_canonical) return null;
                      const sector = s.sector_canonical as string;
                      return (
                        <button
                          key={sector}
                          className="health-list-item"
                          onClick={() => onSectorPick?.(sector, titleCase(sector))}
                        >
                          <span>{titleCase(sector)}</span>
                          <span className="num">
                            {cat.id === 'sin_inscritos'
                              ? n(s.padron_sujetos ?? 0)
                              : n(s.ros_2025 ?? 0)}
                          </span>
                        </button>
                      );
                    })}

                    {cat.sectores.length > 20 && (
                      <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>
                        +{n(cat.sectores.length - 20)} más
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
