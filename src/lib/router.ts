import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { view: 'pulso' }
  | { view: 'senales'; family?: string }
  | { view: 'entidades'; q?: string; region?: string }
  | { view: 'ficha'; entityId: string }
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
