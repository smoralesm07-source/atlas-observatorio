import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { hrefFor, type Route } from '../lib/router';
import type { AtlasRole } from './Auth';
import { Mark } from './Mark';
import '../styles/monitores-nav.css';

const NAV: { label: string; route: Route; match: Route['view'][] }[] = [
  { label: 'Entidades', route: { view: 'entidades' }, match: ['entidades', 'ficha'] },
  { label: 'Universo SO', route: { view: 'universo' }, match: ['universo'] },
  { label: 'Territorio', route: { view: 'territorio' }, match: ['territorio'] },
  { label: 'Gasto público', route: { view: 'gasto' }, match: ['gasto', 'gastoActor'] },
  { label: 'Fuentes', route: { view: 'fuentes' }, match: ['fuentes'] },
];

const MONITORS: { label: string; route: Route; view: 'osfl' | 'fintech' | 'sanciones' }[] = [
  { label: 'OSFL', route: { view: 'osfl' }, view: 'osfl' },
  { label: 'Fintech', route: { view: 'fintech' }, view: 'fintech' },
  { label: 'Sanciones', route: { view: 'sanciones' }, view: 'sanciones' },
];

function MonitorGlyph({ view }: { view: 'osfl' | 'fintech' | 'sanciones' }) {
  if (view === 'osfl') {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.65" />
        <circle cx="16.5" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.65" />
        <path d="M3.5 19c.4-3.2 2.4-5 5.1-5h1c2.8 0 4.8 1.8 5.2 5M14.3 14.4c.7-.5 1.6-.7 2.5-.7 2.2 0 3.8 1.4 4.2 4"
          stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
      </svg>
    );
  }
  if (view === 'fintech') {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 19V12h3v7M10.5 19V7h3v12M16 19V4h3v15"
          stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 3.8h7l4 4V20H7a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2Z"
        stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
      <path d="M14 3.8V8h4M9 12h6M9 15.5h6"
        stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
    </svg>
  );
}

export function Shell({
  route,
  session,
  role,
  children,
}: {
  route: Route;
  session: Session;
  role: AtlasRole;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('atlas-obs-theme') as 'dark' | 'light') ?? 'dark',
  );
  const [monitorsOpen, setMonitorsOpen] = useState(false);
  const monitorsRef = useRef<HTMLDivElement>(null);
  const monitorsActive = MONITORS.some((item) => item.view === route.view);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('atlas-obs-theme', theme);
  }, [theme]);

  useEffect(() => {
    setMonitorsOpen(false);
  }, [route.view]);

  useEffect(() => {
    if (!monitorsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!monitorsRef.current?.contains(event.target as Node)) setMonitorsOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMonitorsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeEscape);
    };
  }, [monitorsOpen]);

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

        <nav className="nav" aria-label="Navegación principal">
          <a href={hrefFor({ view: 'pulso' })} data-active={route.view === 'pulso'}>
            Pulso
          </a>

          <div className="monitor-nav" ref={monitorsRef}>
            <button
              type="button"
              className="monitor-nav-trigger"
              data-active={monitorsActive}
              data-open={monitorsOpen}
              aria-haspopup="menu"
              aria-expanded={monitorsOpen}
              onClick={() => setMonitorsOpen((current) => !current)}
            >
              <span>Monitores</span>
              <svg className="monitor-nav-chevron" width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="m5.5 7.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {monitorsOpen && (
              <div className="monitor-menu" role="menu" aria-label="Monitores">
                {MONITORS.map((item) => {
                  const active = route.view === item.view;
                  return (
                    <a
                      key={item.view}
                      href={hrefFor(item.route)}
                      className="monitor-menu-item"
                      data-active={active}
                      role="menuitem"
                      onClick={() => setMonitorsOpen(false)}
                    >
                      <span className="monitor-menu-icon"><MonitorGlyph view={item.view} /></span>
                      <span className="monitor-menu-copy">
                        <strong>{item.label}</strong>
                        <small>{item.view === 'osfl' ? 'Organizaciones sin fines de lucro' : item.view === 'fintech' ? 'Ecosistema Fintech y PSAV' : 'Radar sancionatorio'}</small>
                      </span>
                      <span className="monitor-menu-arrow" aria-hidden>›</span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {NAV.map((item) => (
            <a
              key={item.label}
              href={hrefFor(item.route)}
              data-active={item.match.includes(route.view)}
            >
              {item.label}
            </a>
          ))}

          {role === 'admin' && (
            <a href={hrefFor({ view: 'administracion' })} data-active={route.view === 'administracion'}>
              Administración
            </a>
          )}
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
          <button className="icon-btn" title="Cerrar sesión" onClick={() => supabase.auth.signOut({ scope: 'local' })}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M14 8V5.6A1.6 1.6 0 0 0 12.4 4H5.6A1.6 1.6 0 0 0 4 5.6v12.8A1.6 1.6 0 0 0 5.6 20h6.8a1.6 1.6 0 0 0 1.6-1.6V16M17 15l3-3-3-3M20 12H9"
                stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      <main className={`main view-${route.view}`}>{children}</main>
    </div>
  );
}
