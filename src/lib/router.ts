import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { view: 'pulso' }
  | { view: 'osfl' }
  | { view: 'fintech' }
  | { view: 'senales'; family?: string }
  | { view: 'entidades'; q?: string; region?: string }
  | { view: 'ficha'; entityId: string }
  | { view: 'territorio' }
  | { view: 'sectores' }
  | { view: 'gasto'; familia?: string }
  | { view: 'gastoActor'; actorId: string; role: 'BUYER' | 'SUPPLIER' }
  | { view: 'fuentes' }
  | { view: 'metodologia' };

/** Hash routing: the app is a static bundle, so it must survive a hard reload
 *  and a shared link from any host without server rewrites. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const params = new URLSearchParams(query ?? '');
  const seg = path.split('/').filter(Boolean);

  switch (seg[0]) {
    case 'osfl':
      return { view: 'osfl' };
    case 'fintech':
      return { view: 'fintech' };
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
    case 'sectores':
      return { view: 'sectores' };
    case 'gasto':
      if (seg[1] === 'comprador' && seg[2]) {
        return { view: 'gastoActor', actorId: decodeURIComponent(seg[2]), role: 'BUYER' };
      }
      if (seg[1] === 'proveedor' && seg[2]) {
        return { view: 'gastoActor', actorId: decodeURIComponent(seg[2]), role: 'SUPPLIER' };
      }
      return { view: 'gasto', familia: params.get('familia') ?? undefined };
    case 'fuentes':
      return { view: 'fuentes' };
    case 'metodologia':
      return { view: 'metodologia' };
    default:
      return { view: 'pulso' };
  }
}

export function hrefFor(r: Route): string {
  switch (r.view) {
    case 'osfl':
      return '#/osfl';
    case 'fintech':
      return '#/fintech';
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
    case 'sectores':
      return '#/sectores';
    case 'gasto':
      return r.familia ? `#/gasto?familia=${encodeURIComponent(r.familia)}` : '#/gasto';
    case 'gastoActor':
      return `#/gasto/${r.role === 'BUYER' ? 'comprador' : 'proveedor'}/${encodeURIComponent(r.actorId)}`;
    case 'fuentes':
      return '#/fuentes';
    case 'metodologia':
      return '#/metodologia';
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
