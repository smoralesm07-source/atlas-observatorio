import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { hrefFor, type Route } from '../lib/router';
import { Mark } from './Mark';

const NAV: { label: string; route: Route; match: Route['view'][] }[] = [
  { label: 'Pulso', route: { view: 'pulso' }, match: ['pulso'] },
  { label: 'Señales', route: { view: 'senales' }, match: ['senales'] },
  { label: 'Entidades', route: { view: 'entidades' }, match: ['entidades', 'ficha'] },
  { label: 'Fuentes', route: { view: 'fuentes' }, match: ['fuentes'] },
  { label: 'Metodología', route: { view: 'metodologia' }, match: ['metodologia'] },
];

export function Shell({
  route,
  session,
  children,
}: {
  route: Route;
  session: Session;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('atlas-obs-theme') as 'dark' | 'light') ?? 'dark',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('atlas-obs-theme', theme);
  }, [theme]);

  // "/" focuses search from anywhere: entity lookup is the primary act here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        if (route.view !== 'entidades') window.location.hash = hrefFor({ view: 'entidades' });
        setTimeout(() => document.getElementById('obs-search')?.focus(), 60);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.view]);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href={hrefFor({ view: 'pulso' })}>
          <Mark size={26} animated />
          <span>
            <span className="brand-name">ATLAS Observatorio</span>
            <span className="brand-sub" style={{ display: 'block' }}>
              Monitor de fuentes abiertas
            </span>
          </span>
        </a>

        <nav className="nav">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={hrefFor(item.route)}
              data-active={item.match.includes(route.view)}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="topbar-right">
          <span
            style={{ fontSize: 11.5, color: 'var(--ink-3)', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={session.user.email ?? ''}
          >
            {session.user.email}
          </span>
          <button
            className="icon-btn"
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M20 14.4A8.4 8.4 0 1 1 9.6 4a6.9 6.9 0 0 0 10.4 10.4Z"
                  stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <button className="icon-btn" title="Cerrar sesión" onClick={() => supabase.auth.signOut()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M14 8V5.6A1.6 1.6 0 0 0 12.4 4H5.6A1.6 1.6 0 0 0 4 5.6v12.8A1.6 1.6 0 0 0 5.6 20h6.8a1.6 1.6 0 0 0 1.6-1.6V16M17 15l3-3-3-3M20 12H9"
                stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
