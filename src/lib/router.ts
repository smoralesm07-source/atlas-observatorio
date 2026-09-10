import { useCallback, useEffect, useState } from 'react';
import type { UafLens } from './contracts';

const LENTES: UafLens[] = ['reportabilidad', 'revision', 'territorio', 'ciclo'];

/* Universo SO tiene dos ejes: la situación del padrón inscrito y la mesa de
   casos de los dos bordes del registro. Los nombres antiguos de la URL
   —brechas y gestión— siguen resolviendo, porque hay enlaces vivos apuntando a
   ellos desde el Pulso y desde fuera. */
export type UniversoMode = 'padron' | 'casos';
export type UniversoQueue = 'potenciales' | 'termino' | 'cartera';

const UNIVERSO_MODES: UniversoMode[] = ['padron', 'casos'];
const UNIVERSO_QUEUES: UniversoQueue[] = ['potenciales', 'termino', 'cartera'];

function asLens(v: string | null): UafLens | undefined {
  return LENTES.includes(v as UafLens) ? (v as UafLens) : undefined;
}

function asUniversoQueue(v: string | null): UniversoQueue | undefined {
  return UNIVERSO_QUEUES.includes(v as UniversoQueue) ? (v as UniversoQueue) : undefined;
}

/** Devuelve el eje y, cuando el alias antiguo lo implicaba, la cola con la que
 *  abre. «brechas» era la conciliación y «gestión» era la mesa de trabajo. */
function asUniverso(v: string | null): { mode?: UniversoMode; cola?: UniversoQueue } {
  if (v === 'brechas') return { mode: 'casos', cola: 'potenciales' };
  if (v === 'gestion') return { mode: 'casos', cola: 'cartera' };
  return { mode: UNIVERSO_MODES.includes(v as UniversoMode) ? (v as UniversoMode) : undefined };
}

export type Route =
  /** La lente activa viaja en la URL: un enlace al Pulso abre la misma lente. */
  | { view: 'pulso'; lente?: UafLens }
  | { view: 'universo'; mode?: UniversoMode; cola?: UniversoQueue }
  /** Alias de compatibilidad: los enlaces antiguos siguen resolviendo. */
  | { view: 'cobertura' }
  | { view: 'sectores' }
  | { view: 'osfl' }
  | { view: 'fintech' }
  | { view: 'sanciones' }
  | { view: 'senales'; family?: string }
  | { view: 'entidades'; q?: string; region?: string }
  | { view: 'ficha'; entityId: string }
  | { view: 'territorio' }
  | { view: 'fuentes' }
  | { view: 'metodologia' }
  | { view: 'administracion' };

/** Hash routing: the app is a static bundle, so it must survive a hard reload
 *  and a shared link from any host without server rewrites. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const params = new URLSearchParams(query ?? '');
  const seg = path.split('/').filter(Boolean);

  switch (seg[0]) {
    case 'pulso':
      return { view: 'pulso', lente: asLens(params.get('lente')) };
    case 'universo-so':
    case 'universo': {
      const universo = asUniverso(params.get('vista'));
      return {
        view: 'universo',
        mode: universo.mode,
        cola: asUniversoQueue(params.get('cola')) ?? universo.cola,
      };
    }
    case 'cobertura':
      return { view: 'universo', mode: 'casos', cola: 'potenciales' };
    case 'sectores':
      return { view: 'universo', mode: 'padron' };
    case 'osfl':
      return { view: 'osfl' };
    case 'fintech':
      return { view: 'fintech' };
    case 'sanciones':
      return { view: 'sanciones' };
    case 'senales':
      return { view: 'senales', family: params.get('familia') ?? undefined };
    case 'entidades':
      return {
        view: 'entidades',
        q: params.get('q') ?? undefined,
        region: params.get('region') ?? undefined,
      };
    case 'entidad':
      return seg[1]
        ? { view: 'ficha', entityId: decodeURIComponent(seg[1]) }
        : { view: 'entidades' };
    case 'territorio':
      return { view: 'territorio' };
    case 'fuentes':
      return { view: 'fuentes' };
    case 'metodologia':
      return { view: 'metodologia' };
    case 'administracion':
      return { view: 'administracion' };
    default:
      return { view: 'pulso' };
  }
}

export function hrefFor(r: Route): string {
  switch (r.view) {
    case 'universo': {
      if (!r.mode || r.mode === 'padron') return '#/universo-so';
      return r.cola ? `#/universo-so?vista=casos&cola=${r.cola}` : '#/universo-so?vista=casos';
    }
    case 'cobertura':
      return '#/universo-so?vista=casos&cola=potenciales';
    case 'sectores':
      return '#/universo-so';
    case 'osfl':
      return '#/osfl';
    case 'fintech':
      return '#/fintech';
    case 'sanciones':
      return '#/sanciones';
    case 'senales':
      return r.family ? `#/senales?familia=${encodeURIComponent(r.family)}` : '#/senales';
    case 'entidades': {
      const p = new URLSearchParams();
      if (r.q) p.set('q', r.q);
      if (r.region) p.set('region', r.region);
      const qs = p.toString();
      return qs ? `#/entidades?${qs}` : '#/entidades';
    }
    case 'ficha':
      return `#/entidad/${encodeURIComponent(r.entityId)}`;
    case 'territorio':
      return '#/territorio';
    case 'fuentes':
      return '#/fuentes';
    case 'metodologia':
      return '#/metodologia';
    case 'administracion':
      return '#/administracion';
    case 'pulso':
      return r.lente ? `#/pulso?lente=${r.lente}` : '#/pulso';
    default:
      return '#/pulso';
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = hrefFor(r);
  }, []);

  return [route, navigate];
}
