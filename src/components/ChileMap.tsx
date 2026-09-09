/* Mapa comunal del IGR.
 *
 * Chile mide 4.300 km de norte a sur y rara vez más de 200 km de ancho: dibujado
 * completo en un panel queda una astilla donde ninguna comuna es clickeable. El
 * país se corta en tres franjas que se muestran lado a lado —cada una con su
 * propia escala, declarada— y la Región Metropolitana lleva ampliación porque
 * concentra 52 comunas diminutas y la mayor densidad de amenaza alta.
 *
 * La geometría es estática y vive en public/geo/comunas.json sin puntajes; el
 * IGR llega del contrato. Se unen por CUT comunal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TerritoryCommune } from '../lib/contracts';
import { n1 } from '../lib/format';

export interface GeoComuna {
  cut: string;
  nombre: string;
  region: string;
  franja: 'norte' | 'centro' | 'sur';
  d: string;
}
export interface GeoPayload {
  meta: Record<string, unknown>;
  lienzo: { w: number; h: number };
  franjas: Record<string, [number, number, number, number]>;
  regiones: Record<string, [number, number, number, number]>;
  orden_regiones: string[];
  comunas: GeoComuna[];
}

/** Misma rampa ordenada que el resto de la vista; el nivel siempre se nombra. */
const LEVEL_STEP: Record<string, number> = {
  'Muy bajo': 1, Bajo: 2, Moderado: 2, Medio: 3, Alto: 4, 'Muy alto': 5,
};
const levelStep = (l: string | null | undefined) => LEVEL_STEP[l ?? ''] ?? 1;

const FRANJAS: { id: 'norte' | 'centro' | 'sur'; titulo: string; tramo: string }[] = [
  { id: 'norte', titulo: 'Norte', tramo: 'Arica y Parinacota → Coquimbo' },
  { id: 'centro', titulo: 'Centro', tramo: 'Valparaíso → Ñuble' },
  { id: 'sur', titulo: 'Sur', tramo: 'Biobío → Magallanes' },
];
const RM = '13';
const INSET_RATIO = 0.42;
const GAP = 16;

interface Hover { cut: string; x: number; y: number }

export function ChileMap({
  comunas, region, selected, onSelect, onExitRegion, query,
}: {
  comunas: TerritoryCommune[];
  region: string | null;
  selected: string | null;
  onSelect: (c: TerritoryCommune) => void;
  onExitRegion: () => void;
  query: string;
}) {
  const [geo, setGeo] = useState<GeoPayload | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [width, setWidth] = useState(880);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}geo/comunas.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: GeoPayload) => { if (alive) setGeo(j); })
      .catch(() => { if (alive) setGeoError(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [geo]);

  const byCut = useMemo(() => {
    const m = new Map<string, TerritoryCommune>();
    comunas.forEach((c) => { if (c.commune_code) m.set(c.commune_code, c); });
    return m;
  }, [comunas]);

  const matches = useMemo(() => {
    const q = normalize(query);
    if (!q || !geo) return null;
    return new Set(geo.comunas.filter((g) => normalize(g.nombre).includes(q)).map((g) => g.cut));
  }, [query, geo]);

  if (geoError) {
    return (
      <div className="map-fallback">
        No fue posible cargar la geometría comunal. La tabla de comunas y el
        agregado regional siguen disponibles más abajo.
      </div>
    );
  }
  if (!geo) return <div className="map-fallback">Cargando la geometría comunal…</div>;

  const hovered = hover ? byCut.get(hover.cut) : null;
  const hoveredGeo = hover ? geo.comunas.find((g) => g.cut === hover.cut) : null;

  const paint = (g: GeoComuna) => {
    const row = byCut.get(g.cut);
    const dim = matches ? !matches.has(g.cut) : false;
    return (
      <path
        key={g.cut}
        d={g.d}
        className="map-com"
        data-cut={g.cut}
        data-selected={row?.territory_id === selected || undefined}
        data-dim={dim || undefined}
        fill={row?.igr_level ? `var(--igr-${levelStep(row.igr_level)})` : 'var(--map-nodata)'}
        onMouseEnter={(e) => setHover({ cut: g.cut, x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setHover({ cut: g.cut, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
        onClick={() => { if (row) onSelect(row); }}
      >
        <title>
          {g.nombre}
          {row?.igr_score != null ? ` · IGR ${n1(row.igr_score)} · P${n1(row.igr_percentile)} · ${row.igr_level}` : ' · sin dato'}
        </title>
      </path>
    );
  };

  let body;
  if (region) {
    body = (
      <RegionView geo={geo} region={region} paint={paint} width={width} byCut={byCut} />
    );
  } else {
    // La altura sale del ancho disponible para que el país entre en una fila.
    const ratio = FRANJAS.reduce((a, f) => {
      const b = geo.franjas[f.id];
      return a + b[2] / b[3];
    }, 0) + INSET_RATIO * (geo.regiones[RM][2] / geo.regiones[RM][3]);
    const h = Math.max(280, Math.min(520, (width - GAP * 3 - 28) / ratio));
    const rmH = h * INSET_RATIO;
    const rmW = rmH * (geo.regiones[RM][2] / geo.regiones[RM][3]);
    body = (
      <div className="map-strips">
        {FRANJAS.map((f) => {
          const b = geo.franjas[f.id];
          const w = h * (b[2] / b[3]);
          const list = geo.comunas.filter((g) => g.franja === f.id);
          return (
            <div className="map-strip" key={f.id} style={{ width: w }}>
              <div className="map-strip-head">{f.titulo}<b>{f.tramo}</b></div>
              <svg className="map-svg" viewBox={b.join(' ')} width={w} height={h}
                   role="img" aria-label={`Franja ${f.titulo}, ${list.length} comunas`}>
                {list.map(paint)}
              </svg>
            </div>
          );
        })}
        <div className="map-strip map-inset" style={{ width: rmW + 20 }}>
          <div className="map-strip-head">Ampliación<b>Región Metropolitana</b></div>
          <svg className="map-svg" viewBox={geo.regiones[RM].join(' ')} width={rmW} height={rmH}
               role="img" aria-label="Ampliación de la Región Metropolitana">
            {geo.comunas.filter((g) => g.region === RM).map(paint)}
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="map-host" ref={host}>
      {region && (
        <button className="map-back" onClick={onExitRegion} type="button">← Todo Chile</button>
      )}
      {body}
      {hover && hoveredGeo && (
        <MapTip
          x={hover.x} y={hover.y}
          nombre={hoveredGeo.nombre}
          row={hovered ?? null}
        />
      )}
    </div>
  );
}

/** Una región a escala completa, con zoom y arrastre. */
function RegionView({
  geo, region, paint, width, byCut,
}: {
  geo: GeoPayload;
  region: string;
  paint: (g: GeoComuna) => JSX.Element;
  width: number;
  byCut: Map<string, TerritoryCommune>;
}) {
  const bb = geo.regiones[region];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [region]);

  if (!bb) return <div className="map-fallback">Sin geometría para esta región.</div>;

  const h = Math.min(540, Math.max(320, width * 0.62));
  const w = Math.min(width - 8, h * (bb[2] / bb[3]));
  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  const cx = bb[0] + bb[2] / 2 + clamp(pan.x, bb[2] / 2);
  const cy = bb[1] + bb[3] / 2 + clamp(pan.y, bb[3] / 2);
  const vw = bb[2] / zoom;
  const vh = bb[3] / zoom;
  const list = geo.comunas.filter((g) => g.region === region);

  // Etiquetas sólo donde caben: se recorre por IGR y se descarta la que caería
  // encima de otra ya puesta. Una etiqueta ilegible no informa.
  const minDist = Math.max(vw, vh) / 9;
  const placed: [number, number][] = [];
  const labels: { g: GeoComuna; p: [number, number] }[] = [];
  [...list]
    .sort((a, b) => (byCut.get(b.cut)?.igr_score ?? 0) - (byCut.get(a.cut)?.igr_score ?? 0))
    .forEach((g) => {
      if (labels.length >= 8) return;
      const p = centroid(g.d);
      if (!p) return;
      if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < minDist)) return;
      placed.push(p);
      labels.push({ g, p });
    });

  return (
    <div className="map-zoom">
      <div className="map-zoom-ctl">
        <button type="button" aria-label="Acercar" onClick={() => setZoom((z) => Math.min(14, z * 1.5))}>+</button>
        <button type="button" aria-label="Alejar" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
        <button type="button" aria-label="Encuadrar la región"
                onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⤢</button>
      </div>
      <svg
        ref={svgRef}
        className="map-svg map-svg-region"
        viewBox={[cx - vw / 2, cy - vh / 2, vw, vh].join(' ')}
        width={w} height={h}
        role="img" aria-label={`Comunas de la región, ${list.length} en total`}
        onWheel={(e) => {
          e.preventDefault();
          setZoom((z) => Math.max(1, Math.min(14, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          svgRef.current?.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !svgRef.current) return;
          const r = svgRef.current.getBoundingClientRect();
          setPan({
            x: d.px - ((e.clientX - d.x) * vw) / r.width,
            y: d.py - ((e.clientY - d.y) * vh) / r.height,
          });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        {list.map(paint)}
        {labels.map(({ g, p }) => (
          <text key={g.cut} x={p[0]} y={p[1]} textAnchor="middle" className="map-label"
                fontSize={vh / 44} strokeWidth={vh / 300}>{g.nombre}</text>
        ))}
      </svg>
    </div>
  );
}

function MapTip({ x, y, nombre, row }: {
  x: number; y: number; nombre: string; row: TerritoryCommune | null;
}) {
  const style: React.CSSProperties = {
    left: Math.min(x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240),
    top: y + 14,
  };
  return (
    <div className="map-tip" style={style} role="tooltip">
      <div className="map-tip-n">{nombre}</div>
      {row ? (
        <>
          <div className="map-tip-r">{row.region_name}</div>
          <div className="map-tip-v">
            <i style={{ background: `var(--igr-${levelStep(row.igr_level)})` }} />
            <span className="num">IGR {n1(row.igr_score)}</span> · P{n1(row.igr_percentile)}
          </div>
          <div className="map-tip-c">
            {row.igr_level ?? 'sin banda'} · confianza <span className="num">{n1(row.igr_confidence)}%</span>
          </div>
          <div className="map-tip-c">
            padrón UAF <span className="num">{row.ctx_uaf_observed}</span> ·
            entidades <span className="num">{row.ctx_entities}</span>
          </div>
        </>
      ) : (
        <div className="map-tip-r">Sin dato en el corte</div>
      )}
    </div>
  );
}

/** Centroide aproximado por promedio de vértices: alcanza para posar una etiqueta. */
const centroidCache = new Map<string, [number, number] | null>();
function centroid(d: string): [number, number] | null {
  const hit = centroidCache.get(d);
  if (hit !== undefined) return hit;
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  let out: [number, number] | null = null;
  if (nums && nums.length >= 2) {
    let sx = 0, sy = 0, k = 0;
    for (let i = 0; i + 1 < nums.length; i += 2) { sx += +nums[i]; sy += +nums[i + 1]; k++; }
    out = [sx / k, sy / k];
  }
  centroidCache.set(d, out);
  return out;
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
