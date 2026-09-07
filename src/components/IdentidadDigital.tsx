import { useEffect, useMemo, useState } from 'react';
import {
  aliasEvidenceScore, aliasRuleLabel, deepenAlias, evidenceLevel, resolveIdentity,
  type AliasCandidate, type DeepResult, type IdentityProfile, type IdentityResolution,
} from '../lib/connectors';
import { Badge, Empty, ErrorBox, Loading, Panel, Semantics } from './primitives';
import { n, titleCase } from '../lib/format';

interface DeepEntry {
  alias: string;
  data: DeepResult | null;
  error: string | null;
}

/** Nombre → aliases explicables → perfiles → profundización.
 *  Un alias generado es una hipótesis técnica, nunca una atribución. */
export function IdentidadDigital({
  query,
  onSettled,
}: {
  query: string;
  onSettled?: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'resolving' | 'deepening' | 'done' | 'error'>('idle');
  const [resolution, setResolution] = useState<IdentityResolution | null>(null);
  const [deep, setDeep] = useState<DeepEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  useEffect(() => {
    let live = true;
    setPhase('resolving');
    setResolution(null);
    setDeep([]);
    setError(null);

    (async () => {
      try {
        const r = await resolveIdentity(query);
        if (!live) return;
        setResolution(r);

        const candidates = (r.candidate_aliases ?? [])
          .filter((a) => a.profiles > 0)
          .sort(
            (a, b) =>
              Number(b.evidence_strength ?? 0) - Number(a.evidence_strength ?? 0) ||
              Number(b.profiles ?? 0) - Number(a.profiles ?? 0),
          )
          .slice(0, 2);

        if (!candidates.length) {
          setPhase('done');
          onSettled?.();
          return;
        }

        setPhase('deepening');
        setProgress(
          `${candidates.length} alias con señal. Profundizando con Maigret sobre hasta 650 sitios…`,
        );
        const results = await Promise.all(
          candidates.map(async (a): Promise<DeepEntry> => {
            try {
              return { alias: a.alias, data: await deepenAlias(a.alias), error: null };
            } catch (e) {
              return { alias: a.alias, data: null, error: (e as Error).message };
            }
          }),
        );
        if (!live) return;
        setDeep(results);
        setPhase('done');
        onSettled?.();
      } catch (e) {
        if (!live) return;
        setError((e as Error).message);
        setPhase('error');
      }
    })();

    return () => {
      live = false;
    };
    // onSettled sólo notifica; volver a suscribir por su identidad relanzaría
    // el barrido completo en cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fusion = useMemo(() => fuse(deep), [deep]);

  const ranked = useMemo(() => {
    if (!resolution) return [];
    return (resolution.candidate_aliases ?? [])
      .filter((a) => a.profiles > 0)
      .map((a) => ({
        ...a,
        score: aliasEvidenceScore(a, resolution.records ?? [], deep.find((d) => d.alias === a.alias)?.data),
      }))
      .sort((a, b) => b.score - a.score);
  }, [resolution, deep]);

  if (phase === 'resolving') return <Loading label="Resolviendo nombre → aliases → perfiles…" />;
  if (phase === 'error') return <ErrorBox error={error ?? 'Error desconocido'} />;
  if (!resolution) return null;

  const a = resolution.analytics ?? {};
  const strongAttrs = fusion.attributes.filter((x) => x.corroborated || x.alias_count >= 2);
  const strongLinks = fusion.pivots.filter((x) => x.alias_count >= 2 || x.profiles >= 2);

  return (
    <div className="grid fade-in" style={{ gap: 14 }}>
      {phase === 'deepening' && (
        <div className="note" style={{ margin: 0 }}>{progress}</div>
      )}

      <div className="grid grid-4">
        <Kpi value={n(a.generated_aliases)} label="Aliases generados" />
        <Kpi value={n(a.profiles ?? resolution.records?.length ?? 0)} label="Perfiles observados" />
        <Kpi value={n(strongAttrs.length)} label="Atributos corroborados" tone="var(--accent)" />
        <Kpi value={n(strongLinks.length)} label="Pivotes fuertes" tone="var(--accent)" />
      </div>

      <Panel
        title="Hipótesis de alias priorizadas"
        meta="orden por fuerza de evidencia técnica"
      >
        {ranked.length === 0 ? (
          <Empty
            title="Ningún alias alcanzó evidencia suficiente"
            hint="Atlas generó variantes de username explicables, pero ninguna devolvió perfiles con señal. La ausencia de perfiles no dice nada sobre la persona."
          />
        ) : (
          <div className="grid grid-3" style={{ gap: 10 }}>
            {ranked.slice(0, 6).map((al) => (
              <AliasCard key={al.alias} alias={al} score={al.score} />
            ))}
          </div>
        )}
      </Panel>

      {fusion.attributes.length > 0 && (
        <div className="grid grid-2">
          <Panel title="Matriz de corroboración" meta="atributos repetidos entre perfiles o aliases">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {fusion.attributes.slice(0, 14).map((x) => (
                <div
                  key={`${x.field}|${x.value}`}
                  style={{
                    display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10,
                    alignItems: 'baseline', paddingBottom: 8,
                    borderBottom: '1px solid var(--line-soft)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 650 }}>
                      {titleCase(x.field)}
                    </div>
                    <div style={{ fontSize: 12.5, wordBreak: 'break-word' }}>{x.value}</div>
                  </div>
                  <Badge tone={x.corroborated || x.alias_count >= 2 ? 'present' : 'neutral'}>
                    {x.alias_count} alias · {x.profiles} perfil
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Enlaces pivote" meta="prioridad a links repetidos">
            {fusion.pivots.length === 0 ? (
              <Empty title="Sin enlaces pivote" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {fusion.pivots.slice(0, 14).map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-tile"
                    style={{ textDecoration: 'none' }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="sname" style={{ wordBreak: 'break-all' }}>{l.host || l.url}</div>
                      <div className="sdesc">{l.alias_count} alias · {l.profiles} perfil(es)</div>
                    </div>
                    <span style={{ color: 'var(--ink-4)' }}>↗</span>
                  </a>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {fusion.derivedAliases.length > 0 && (
        <Panel title="Aliases derivados" meta="encontrados dentro de perfiles públicos">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {fusion.derivedAliases.slice(0, 18).map((x) => (
              <span key={x.alias} className="chip" style={{ cursor: 'default' }}>
                @{x.alias}
                <em style={{ color: 'var(--ink-4)', fontStyle: 'normal' }}>
                  {x.origin_count} origen · {x.profiles} perfil
                </em>
              </span>
            ))}
          </div>
        </Panel>
      )}

      {(resolution.records?.length ?? 0) > 0 && (
        <Panel title={`Perfiles observados · ${resolution.records.length}`} pad={false}>
          <div className="grid grid-3" style={{ gap: 0 }}>
            {resolution.records.slice(0, 36).map((r, i) => (
              <ProfileRow key={`${r.source_url}|${i}`} profile={r} />
            ))}
          </div>
        </Panel>
      )}

      <Semantics>
        <strong>Cómo leer la identidad digital.</strong> Atlas genera variantes de username
        a partir del nombre siguiendo reglas explicables y busca evidencia pública en
        plataformas. La <em>fuerza de evidencia</em> mide riqueza y convergencia técnica —
        cuántas plataformas, cuántos motores coinciden, cuántos atributos se repiten— y no
        es probabilidad de que la persona sea la que buscas. Un alias con señal es una
        hipótesis para corroborar contra contenido, bio, ubicación y enlaces cruzados. No
        crea identidad canónica ni modifica la prioridad analítica de ninguna entidad.
      </Semantics>
    </div>
  );
}

function AliasCard({ alias, score }: { alias: AliasCandidate; score: number }) {
  const level = evidenceLevel(score);
  const tone = score >= 75 ? 'critical' : score >= 55 ? 'high' : score >= 35 ? 'medium' : 'watch';
  return (
    <div className="source-tile" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <b className="mono" style={{ fontSize: 13.5 }}>@{alias.alias}</b>
        <Badge tone={tone as 'high'}>{score}/100</Badge>
      </div>
      <div className="sdesc">{aliasRuleLabel(alias.rule)}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
        {n(alias.profiles)} perfil(es) · evidencia {level}
      </div>
    </div>
  );
}

function ProfileRow({ profile }: { profile: IdentityProfile }) {
  const e = profile.evidence ?? {};
  const engines = e.engines ?? [];
  return (
    <a
      href={profile.source_url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        padding: '11px 14px', borderTop: '1px solid var(--line-soft)',
        borderRight: '1px solid var(--line-soft)', display: 'block', minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>
        {e.platform || profile.title || 'Perfil'}
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', wordBreak: 'break-all' }}>
        @{e.username || profile.related_entity_name || ''}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 3 }}>
        {engines.length >= 2 ? `${engines.length} motores` : '1 motor'}
        {engines.length ? ` · ${engines.join(' + ')}` : ''}
      </div>
    </a>
  );
}

function Kpi({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-value num" style={{ fontSize: 23, color: tone }}>{value}</div>
      <div className="stat-label" style={{ marginTop: 4 }}>{label}</div>
    </div>
  );
}

/* Fusiona lo que devolvieron las profundizaciones: un atributo que aparece bajo
   dos aliases distintos vale más que el mismo atributo repetido en un alias. */
function fuse(deep: DeepEntry[]) {
  const attrMap = new Map<string, { field: string; value: string; aliases: Set<string>; profiles: number; corroborated: boolean }>();
  const linkMap = new Map<string, { url: string; host: string; aliases: Set<string>; profiles: number }>();
  const aliasMap = new Map<string, { alias: string; origins: Set<string>; profiles: number; corroborated: boolean }>();

  const norm = (v: unknown) =>
    String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  for (const d of deep) {
    if (!d.data?.ok) continue;
    const intel = d.data.derived?.intelligence ?? {};

    for (const a of intel.attributes ?? []) {
      const key = `${norm(a.field)}|${norm(a.value)}`;
      if (key === '|') continue;
      const g = attrMap.get(key) ?? {
        field: a.field || 'Dato', value: String(a.value ?? ''),
        aliases: new Set<string>(), profiles: 0, corroborated: false,
      };
      g.aliases.add(d.alias);
      g.profiles = Math.max(g.profiles, Number(a.source_count ?? 0));
      g.corroborated = g.corroborated || !!a.corroborated || Number(a.source_count ?? 0) >= 2;
      attrMap.set(key, g);
    }

    for (const l of intel.links ?? []) {
      const url = String(l.url ?? '');
      if (!url) continue;
      let host = l.host ?? url;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* url libre */ }
      const g = linkMap.get(url) ?? { url, host, aliases: new Set<string>(), profiles: 0 };
      g.aliases.add(d.alias);
      g.profiles = Math.max(g.profiles, Number(l.source_count ?? 0));
      linkMap.set(url, g);
    }

    for (const c of intel.alias_candidates ?? []) {
      const key = norm(c.alias);
      if (!key) continue;
      const g = aliasMap.get(key) ?? {
        alias: c.alias, origins: new Set<string>(), profiles: 0, corroborated: false,
      };
      g.origins.add(d.alias);
      g.profiles = Math.max(g.profiles, Number(c.source_count ?? 0));
      g.corroborated = g.corroborated || !!c.corroborated || Number(c.source_count ?? 0) >= 2;
      aliasMap.set(key, g);
    }
  }

  return {
    attributes: [...attrMap.values()]
      .map((x) => ({ ...x, alias_count: x.aliases.size }))
      .sort((a, b) =>
        Number(b.corroborated) - Number(a.corroborated) ||
        b.alias_count - a.alias_count || b.profiles - a.profiles),
    pivots: [...linkMap.values()]
      .map((x) => ({ ...x, alias_count: x.aliases.size }))
      .sort((a, b) => b.alias_count - a.alias_count || b.profiles - a.profiles),
    derivedAliases: [...aliasMap.values()]
      .map((x) => ({ ...x, origin_count: x.origins.size }))
      .sort((a, b) =>
        b.origin_count - a.origin_count ||
        Number(b.corroborated) - Number(a.corroborated) || b.profiles - a.profiles),
  };
}
