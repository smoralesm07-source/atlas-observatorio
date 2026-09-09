import { useMemo, useState } from 'react';
import { useRpc } from '../lib/rpc';
import { hrefFor } from '../lib/router';
import type { UafPotential, UafPotentialCandidate, UafIvoComponent } from '../lib/contracts';
import { Empty, ErrorBox, Loading, Panel, Semantics } from '../components/primitives';
import { fecha, n, n1, rutFormat, titleCase } from '../lib/format';

/* QUIÉNES PODRÍAN SER SUJETOS OBLIGADOS
   ─────────────────────────────────────
   La versión anterior de esta pantalla decía CUÁNTOS faltan: 79.449 RUT, 34
   gatillantes, la razón por sector. Todo cierto, y nada que un analista pudiera
   abrir: la línea base llegaba declarada y sin RUT.

   Esta versión responde QUIÉNES son. El embudo lleva del universo observado a
   la cola que se puede trabajar, y cada entidad de esa cola trae su ficha: por
   qué aparece, cuánto ordena mirarla, de qué tamaño es y qué la respalda. El
   analista discrimina desde la tarjeta, sin abrir nada.

   LO QUE LA PANTALLA NUNCA AFIRMA:
    · El candidato es una hipótesis de registro. No acredita que reúna los
      elementos que activan la obligación de inscribirse, ni que incumpla.
    · El IVO ordena revisión: no es probabilidad de obligación ni de LA/FT.
    · La materialidad mide el costo de incorporar, no la gravedad de nada.
    · Ausencia del corte público UAF no equivale a no estar inscrita. */

type Orden = 'ivo' | 'materialidad' | 'escala' | 'antiguedad';

const BANDA_TONO: Record<string, string> = {
  ALTA: 'var(--sig-critical)',
  MEDIA: 'var(--sig-high)',
  BAJA: 'var(--sig-watch)',
};

const COHERENCIA: Record<string, { label: string; hint: string; tone: string }> = {
  COHERENTE: {
    label: 'Tipo coherente',
    hint: 'Su forma societaria es la habitual entre los inscritos del sector.',
    tone: 'var(--present)',
  },
  RARO: {
    label: 'Tipo poco frecuente',
    hint: 'Su forma societaria es inusual entre los inscritos del sector. Describe una distancia, no una irregularidad.',
    tone: 'var(--sig-medium)',
  },
  SIN_REFERENCIA_DE_TIPO: {
    label: 'Sin referencia de tipo',
    hint: 'El sector no tiene suficientes inscritos para decir qué forma societaria es la habitual.',
    tone: 'var(--ink-4)',
  },
};

const EVIDENCIA: Record<string, string> = {
  GIRO_PRINCIPAL_CARACTERISTICO: 'Giro principal',
  GIRO_SECUNDARIO_CARACTERISTICO: 'Giro secundario',
};

const REVISION: Record<string, { label: string; tone: string }> = {
  CANDIDATO_SELECCIONADO: { label: 'Seleccionado como candidato', tone: 'var(--accent)' },
  REVISADO: { label: 'Revisado', tone: 'var(--sig-watch)' },
  DESCARTADO: { label: 'Descartado', tone: 'var(--ink-4)' },
};

export function Cobertura({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { data, error, loading, reload } = useRpc<UafPotential>('obs_uaf_potential', {});

  const [q, setQ] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [banda, setBanda] = useState<string | null>(null);
  const [coherencia, setCoherencia] = useState<string | null>(null);
  const [soloSinRevisar, setSoloSinRevisar] = useState(false);
  const [orden, setOrden] = useState<Orden>('ivo');
  const [abierta, setAbierta] = useState<string | null>(null);

  const candidatos = data?.candidatos ?? [];

  const filtrados = useMemo(() => {
    const texto = q.trim().toLowerCase();
    const rows = candidatos.filter((c) => {
      if (sector && c.implied_sector !== sector) return false;
      if (banda && (c.ivo_band ?? 'SIN_BANDA') !== banda) return false;
      if (coherencia && (c.type_coherence_class ?? 'SIN_REFERENCIA_DE_TIPO') !== coherencia) return false;
      if (soloSinRevisar && c.review_state) return false;
      if (!texto) return true;
      return (
        c.name.toLowerCase().includes(texto)
        || c.rut.toLowerCase().includes(texto)
        || (c.matched_activity ?? '').toLowerCase().includes(texto)
      );
    });
    const v = (x: number | null | undefined) => (x == null ? -1 : x);
    return rows.sort((a, b) => {
      if (orden === 'materialidad') return v(b.materiality_score) - v(a.materiality_score);
      if (orden === 'escala') return v(b.sales_band_rank) - v(a.sales_band_rank);
      if (orden === 'antiguedad') return v(b.activity_years) - v(a.activity_years);
      return v(b.ivo_score) - v(a.ivo_score);
    });
  }, [candidatos, q, sector, banda, coherencia, soloSinRevisar, orden]);

  if (loading) return <Loading label="Calificando entidades observadas por giro…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.disponible || !data.totales) {
    return (
      <Empty
        title="Sin corte de screening publicado"
        hint="La homologación empírica UAF–SII no está disponible en este snapshot."
      />
    );
  }

  const t = data.totales;
  const corte = data.corte;
  const maxEmbudo = Math.max(1, ...data.embudo.map((e) => e.n));
  const conFiltro = sector || banda || coherencia || soloSinRevisar || q.trim();
  const sectoresConAccionables = data.sectores.filter((s) => s.accionables > 0);

  const limpiar = () => {
    setQ(''); setSector(null); setBanda(null); setCoherencia(null); setSoloSinRevisar(false);
  };

  return (
    <div className="fade-in">
      <header className="pulse-command cov-command">
        <div style={{ minWidth: 0 }}>
          <div className="pulse-kicker">Screening SII ↔ UAF · hipótesis de registro</div>
          <h1>Quiénes podrían ser sujetos obligados</h1>
          <p className="view-lede">
            {n(t.observadas)} entidades declaran ante el SII un giro característico de un sector de
            la Ley 19.913 y no figuran en el padrón de la UAF. De ellas, <b>{n(t.accionables)} operan
            vigentes y están calificadas</b>: son las que un analista puede revisar hoy, una por una.
            Declarar un giro alcanzado no prueba que la entidad reúna los elementos que activan la
            obligación de inscribirse.
          </p>
        </div>
        <div className="pulse-meta">
          <span className="pulse-meta-item"><i /><b>Nómina SII</b> {corte.sii_periodo ?? '—'}</span>
          <span className="pulse-meta-item"><b>Padrón UAF</b> {corte.uaf_corte ?? '—'}</span>
          <span className="pulse-meta-item"><b>Índice</b> {corte.index_version ?? '—'}</span>
        </div>
        <div className="pulse-quick">
          <a className="chip" href={hrefFor({ view: 'pulso' })}>← Volver al Pulso</a>
          <a className="chip" href={corte.fuente_url} target="_blank" rel="noreferrer">
            Nómina de personas jurídicas del SII →
          </a>
        </div>
      </header>

      {/* ── 1. El embudo: de 74 mil observaciones a una cola de trabajo ── */}
      <section className="funnel">
        {data.embudo.map((paso, i) => {
          const previo = i > 0 ? data.embudo[i - 1].n : null;
          const caida = previo && previo > 0 ? 100 - (paso.n / previo) * 100 : null;
          const ultimo = i === data.embudo.length - 1;
          return (
            <div className="funnel-step" key={paso.orden} data-focus={i === 2}>
              <div className="funnel-head">
                <span className="funnel-n num">{n(paso.n)}</span>
                {caida != null && caida > 0 && (
                  <span className="funnel-drop num" title={`Cae ${n1(caida)}% respecto del paso anterior`}>
                    −{n1(caida)}%
                  </span>
                )}
              </div>
              <div className="funnel-bar">
                {/* La barra usa escala logarítmica: entre 74.087 y 5 hay cuatro
                    órdenes de magnitud, y en lineal los dos últimos pasos
                    desaparecerían justo cuando son los que importan. */}
                <i style={{ width: `${(Math.log10(1 + paso.n) / Math.log10(1 + maxEmbudo)) * 100}%` }} />
              </div>
              <div className="funnel-label">{paso.etiqueta}</div>
              <p className="funnel-glosa">{paso.glosa}</p>
              {!ultimo && <span className="funnel-arrow" aria-hidden>→</span>}
            </div>
          );
        })}
      </section>
      <p className="funnel-note">
        Escala logarítmica: el embudo recorre cuatro órdenes de magnitud y en escala lineal los dos
        últimos pasos —los únicos accionables— no se verían. Conserva el orden, no la proporción.
      </p>

      {/* ── 2. Cuatro cifras de mando ─────────────────────────────────── */}
      <div className="kpi-row cov-kpis">
        <CovKpi label="Cola accionable" value={n(t.accionables)} tone="var(--sig-high)"
          share={`de ${n(t.observadas)} observadas`}
          foot="operación vigente y giro característico calificado" />
        <CovKpi label="Sin revisar" value={n(t.sin_revisar)} tone="var(--sig-critical)"
          share={`${n(t.revisados)} ya tienen pronunciamiento`}
          foot="nadie se ha pronunciado todavía sobre estas" />
        <CovKpi label="IVO medio" value={n1(t.ivo_medio)} tone="var(--sig-medium)"
          share={`máximo ${n1(t.ivo_max)} de 100`}
          foot="ordena revisión · no es probabilidad de obligación" />
        <CovKpi label="Materialidad media" value={n1(t.materialidad_media)} tone="var(--unknown)"
          share={`${n(t.sectores)} sectores implicados`}
          foot="costo de incorporar al padrón · no mide gravedad" />
      </div>

      {/* ── 3. Perfil de la cola y de dónde sale ──────────────────────── */}
      <div className="pulse-grid-wide" style={{ marginBottom: 16 }}>
        <Panel title="De dónde salen los candidatos" meta="observadas contra calificadas, por sector">
          <div className="sect-rows">
            {sectoresConAccionables.map((s) => {
              const on = sector === s.sector;
              return (
                <button
                  key={s.sector}
                  className="sect-row"
                  data-on={on}
                  onClick={() => setSector(on ? null : s.sector)}
                  title={`${n(s.observadas)} observadas · ${n(s.accionables)} con hipótesis accionable`}
                >
                  <span className="sect-name">{titleCase(s.sector)}</span>
                  <span className="sect-track">
                    <i className="sect-obs" style={{ width: '100%' }} />
                    <i
                      className="sect-acc"
                      style={{ width: `${Math.max(1.5, (s.accionables / Math.max(1, s.observadas)) * 100)}%` }}
                    />
                  </span>
                  <span className="sect-nums num">
                    <b>{n(s.accionables)}</b>
                    <em>de {n(s.observadas)}</em>
                  </span>
                </button>
              );
            })}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            La barra tenue es todo lo observado del sector y la marca de color, lo que quedó
            calificado. Que un sector enorme aporte pocos candidatos no significa que esté limpio:
            significa que la calificación exige operación vigente y giro característico, y que el
            resto no pasa ese filtro con la evidencia disponible hoy.
          </p>
        </Panel>

        <Panel title="Perfil de la cola" meta={`${n(t.accionables)} entidades`}>
          <div className="panel-sub">Cuánto ordena mirar · banda IVO</div>
          <div className="mixrow">
            {data.mix.banda.map((b) => (
              <button
                key={b.banda}
                className="mixchip"
                data-on={banda === b.banda}
                style={{ ['--mix-tone' as string]: BANDA_TONO[b.banda] ?? 'var(--ink-4)' }}
                onClick={() => setBanda(banda === b.banda ? null : b.banda)}
              >
                <i />
                {titleCase(b.banda)}
                <b className="num">{n(b.n)}</b>
                <em className="num">IVO {n1(b.ivo_medio)}</em>
              </button>
            ))}
          </div>

          <div className="panel-sub">Forma societaria frente a sus pares</div>
          <div className="mixrow">
            {data.mix.coherencia.map((c) => {
              const meta = COHERENCIA[c.clase] ?? { label: titleCase(c.clase), hint: '', tone: 'var(--ink-4)' };
              return (
                <button
                  key={c.clase}
                  className="mixchip"
                  data-on={coherencia === c.clase}
                  style={{ ['--mix-tone' as string]: meta.tone }}
                  title={meta.hint}
                  onClick={() => setCoherencia(coherencia === c.clase ? null : c.clase)}
                >
                  <i />
                  {meta.label}
                  <b className="num">{n(c.n)}</b>
                </button>
              );
            })}
          </div>

          <div className="panel-sub">Tamaño declarado ante el SII</div>
          <div className="escala">
            {data.mix.escala.map((e) => (
              <div className="escala-row" key={e.tramo}>
                <span>{e.tramo}</span>
                <span className="escala-bar">
                  <i style={{ width: `${(e.n / Math.max(1, ...data.mix.escala.map((x) => x.n))) * 100}%` }} />
                </span>
                <b className="num">{n(e.n)}</b>
              </div>
            ))}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            El tramo de ventas viene del corte tributario y falta en{' '}
            {n(data.mix.escala.find((e) => e.orden === 0)?.n ?? 0)} de las {n(t.accionables)}: sin él
            la entidad no deja de existir, sólo deja de ser comparable por tamaño.
          </p>
        </Panel>
      </div>

      {/* ── 4. Triage ─────────────────────────────────────────────────── */}
      <div className="triage">
        <div className="triage-search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por razón social, RUT o giro…"
            aria-label="Buscar entre los candidatos"
          />
        </div>
        <button className="chip" data-on={soloSinRevisar} onClick={() => setSoloSinRevisar((v) => !v)}>
          Sólo sin revisar <b className="num">{n(t.sin_revisar)}</b>
        </button>
        <div className="seg">
          <button data-on={orden === 'ivo'} onClick={() => setOrden('ivo')}>IVO</button>
          <button data-on={orden === 'materialidad'} onClick={() => setOrden('materialidad')}>Materialidad</button>
          <button data-on={orden === 'escala'} onClick={() => setOrden('escala')}>Escala</button>
          <button data-on={orden === 'antiguedad'} onClick={() => setOrden('antiguedad')}>Antigüedad</button>
        </div>
        <span className="triage-count num">
          {n(filtrados.length)}
          <em>{filtrados.length === 1 ? ' entidad' : ' entidades'}</em>
        </span>
        {conFiltro && (
          <button className="chip" onClick={limpiar}>Limpiar filtros</button>
        )}
      </div>

      {/* ── 5. Las fichas ─────────────────────────────────────────────── */}
      {filtrados.length === 0 ? (
        <Empty
          title="Ninguna entidad cumple este filtro"
          hint="Amplía el criterio o limpia los filtros para volver a la cola completa."
        />
      ) : (
        <div className="cand-grid">
          {filtrados.map((c) => (
            <FichaCandidato
              key={c.rut}
              c={c}
              abierta={abierta === c.rut}
              onToggle={() => setAbierta(abierta === c.rut ? null : c.rut)}
              onOpenEntity={
                c.entity_id
                  ? () => onNavigate(hrefFor({ view: 'ficha', entityId: c.entity_id as string }))
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <Semantics>
        <strong>Qué significa esta pantalla.</strong> {data.semantics}
      </Semantics>
    </div>
  );
}

/* ─────────────────────────────────────────────── la ficha del candidato */

function FichaCandidato({
  c, abierta, onToggle, onOpenEntity,
}: {
  c: UafPotentialCandidate;
  abierta: boolean;
  onToggle: () => void;
  onOpenEntity?: () => void;
}) {
  const tono = BANDA_TONO[c.ivo_band ?? ''] ?? 'var(--ink-3)';
  const coh = COHERENCIA[c.type_coherence_class ?? 'SIN_REFERENCIA_DE_TIPO'];
  const rev = c.review_state ? REVISION[c.review_state] : null;
  const comps = c.ivo_components ?? [];
  const pesoTotal = Math.max(1, comps.reduce((a, x) => a + (x.weight ?? 0), 0));
  const socios = (c.legal_entity_partner_count ?? 0) + (c.societies_as_partner_count ?? 0);

  return (
    <article className="cand" style={{ ['--cand-tone' as string]: tono }}>
      <header className="cand-head">
        <div style={{ minWidth: 0 }}>
          <h3 title={c.name}>{titleCase(c.name)}</h3>
          <div className="cand-sub num">
            {rutFormat(c.rut)}
            <span>·</span>
            <em>{c.implied_sector ? titleCase(c.implied_sector) : 'sin sector implícito'}</em>
          </div>
        </div>
        <div className="cand-score" title="Índice de verosimilitud de obligación. Ordena revisión; no es probabilidad de obligación ni de LA/FT.">
          <b className="num">{n1(c.ivo_score)}</b>
          <em>IVO {titleCase(c.ivo_band ?? '—')}</em>
        </div>
      </header>

      {/* El desglose del índice es el argumento de la ficha: cada segmento vale
          lo que pesa dentro del IVO y se llena con lo que ese componente
          realmente aporta. Un tramo vacío dice, sin texto, qué evidencia falta. */}
      <div className="ivo">
        <div className="ivo-track">
          {comps.map((k) => (
            <span
              key={k.code}
              className="ivo-seg"
              style={{ width: `${((k.weight ?? 0) / pesoTotal) * 100}%` }}
              title={`${k.label}: ${n1(k.value)} de 100 · pesa ${n(k.weight)} puntos del índice`}
            >
              <i style={{ width: `${Math.max(0, Math.min(100, k.value ?? 0))}%`, background: tono }} />
            </span>
          ))}
        </div>
        <div className="ivo-legend">
          {comps.map((k) => (
            <span key={k.code} data-vacio={(k.value ?? 0) === 0}>
              {k.code} <b className="num">{n1(k.value)}</b>
            </span>
          ))}
          <span className="ivo-cred">credibilidad {n1(c.ivo_credibility_pct)}%</span>
        </div>
      </div>

      <div className="cand-giro">
        <span className="cand-giro-label">{EVIDENCIA[c.evidence_class ?? ''] ?? 'Giro coincidente'}</span>
        <span className="cand-giro-text">{titleCase(c.matched_activity)}</span>
        {c.activity_concentration != null && (
          <span className="cand-giro-conc">
            lo declara el <b className="num">{n1(c.activity_concentration * 100)}%</b> de los inscritos del sector
            {c.activity_registered_n != null && c.activity_universe_n != null && (
              <em> · {n(c.activity_registered_n)} de {n(c.activity_universe_n)}</em>
            )}
          </span>
        )}
      </div>

      <dl className="cand-attrs">
        <Attr k="Territorio" v={c.region ? (c.commune ? `${c.commune}, ${c.region}` : c.region) : null} vacio="sin territorio observado" />
        <Attr k="Tamaño" v={c.sales_band_size} sub={c.sales_band_uf ?? undefined} vacio="sin tramo declarado" />
        <Attr k="Personal" v={c.workers != null ? `${n(c.workers)} ${c.workers === 1 ? 'trabajador' : 'trabajadores'}` : null} vacio="sin dotación declarada" />
        <Attr
          k="Antigüedad"
          v={c.activity_years != null ? `${n(c.activity_years)} años` : null}
          sub={c.sii_activity_start_date ? `desde ${fecha(c.sii_activity_start_date)}` : undefined}
          vacio="sin inicio observado"
        />
        <Attr k="Estructura" v={socios > 0 ? `${n(socios)} ${socios === 1 ? 'socio' : 'socios'} persona jurídica` : null} vacio="sin socios personas jurídicas" />
        <Attr k="Materialidad" v={c.materiality_score != null ? n1(c.materiality_score) : null} sub="costo de incorporar" vacio="sin medir" />
      </dl>

      <div className="cand-chips">
        {coh && <span className="fchip" style={{ ['--c' as string]: coh.tone }} title={coh.hint}><i />{coh.label}</span>}
        {c.detection_tier && (
          <span className="fchip" style={{ ['--c' as string]: c.detection_tier.startsWith('A') ? 'var(--sig-high)' : 'var(--sig-watch)' }}
            title="Fuerza con que el giro caracteriza al sector.">
            <i />Detección {c.detection_tier.replace('_', ' ').toLowerCase()}
          </span>
        )}
        <span className="fchip" style={{ ['--c' as string]: 'var(--ink-4)' }} title="Fuentes independientes que observan a la entidad.">
          <i />{n(c.source_count)} fuentes
        </span>
        {c.res_available && (
          <span className="fchip" style={{ ['--c' as string]: 'var(--class-official)' }} title="Aparece en el Registro de Empresas y Sociedades.">
            <i />Constitución verificable
          </span>
        )}
        {c.uaf_sanction_events > 0 && (
          <span className="fchip" style={{ ['--c' as string]: 'var(--sig-critical)' }}>
            <i />{n(c.uaf_sanction_events)} antecedentes sancionatorios
          </span>
        )}
      </div>

      {rev && (
        <div className="cand-rev" style={{ ['--r' as string]: rev.tone }}>
          <b>{rev.label}</b>
          {c.review_rationale && <span>«{c.review_rationale}»</span>}
          <em>
            {c.reviewed_by_email ?? 'sin autor registrado'}
            {c.reviewed_at && ` · ${fecha(c.reviewed_at)}`}
          </em>
        </div>
      )}

      <footer className="cand-foot">
        <button className="btn btn-sm" onClick={onToggle} aria-expanded={abierta}>
          {abierta ? 'Ocultar desglose ▲' : 'Ver desglose ▾'}
        </button>
        {onOpenEntity && (
          <button className="btn btn-sm" onClick={onOpenEntity}>Abrir ficha completa →</button>
        )}
      </footer>

      {abierta && <Desglose c={c} comps={comps} />}
    </article>
  );
}

function Desglose({ c, comps }: { c: UafPotentialCandidate; comps: UafIvoComponent[] }) {
  const mat = (c.materiality_components ?? {}) as Record<string, unknown>;
  const lectura = typeof mat.lectura === 'string' ? mat.lectura : null;

  return (
    <div className="desglose">
      <div className="panel-sub">Cómo se compone el IVO</div>
      <table className="table desglose-table">
        <thead>
          <tr>
            <th>Componente</th>
            <th className="right">Valor</th>
            <th className="right">Peso</th>
            <th className="right">Aporta</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((k) => (
            <tr key={k.code}>
              <td>
                <b style={{ color: 'var(--ink)' }}>{k.code}</b> · {k.label}
                {k.tier && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-4)' }}>nivel {k.tier.replace('_', ' ').toLowerCase()}</span>}
              </td>
              <td className="right num">{n1(k.value)}</td>
              <td className="right num" style={{ color: 'var(--ink-4)' }}>{n(k.weight)}</td>
              <td className="right num" style={{ color: (k.value ?? 0) === 0 ? 'var(--ink-4)' : 'var(--ink)' }}>
                {n1(((k.value ?? 0) * (k.weight ?? 0)) / 100)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Que la evidencia regulatoria valga cero en toda la cola es la lectura
          más importante de la ficha: el índice publica esa ausencia en vez de
          repartir su peso entre los componentes que sí tienen dato. */}
      {comps.some((k) => k.code === 'EVR' && (k.value ?? 0) === 0) && (
        <p className="desglose-note">
          Sin evidencia regulatoria directa: ningún acto de un regulador respalda hoy esta hipótesis.
          El índice deja ese peso vacío en vez de repartirlo, y por eso ninguna entidad de la cola
          alcanza puntajes altos.
        </p>
      )}

      <div className="panel-sub">Qué pesa en la materialidad</div>
      <div className="desglose-mat">
        {Object.entries(mat)
          .filter(([k]) => k !== 'lectura')
          .map(([k, v]) => (
            <span key={k}>
              <em>{k}</em>
              <b className="num">{typeof v === 'number' ? n(v) : String(v)}</b>
            </span>
          ))}
      </div>
      {lectura && <p className="desglose-note">{lectura}</p>}

      <div className="panel-sub">Procedencia</div>
      <p className="desglose-note">
        Giro declarado ante el SII{c.activity_codes?.length ? ` · ACTECO ${c.activity_codes.join(', ')}` : ''}
        {c.uaf_sectors?.length ? ` · sector homologado ${c.uaf_sectors.map(titleCase).join(', ')}` : ''}
        {c.screening_evidence_count != null && ` · ${n(c.screening_evidence_count)} evidencia${c.screening_evidence_count === 1 ? '' : 's'} de screening`}
        {c.res_constitution_date && ` · constituida el ${fecha(c.res_constitution_date)}`}.
        {' '}Hipótesis de registro: no acredita obligación ni incumplimiento.
      </p>
    </div>
  );
}

function Attr({ k, v, sub, vacio }: { k: string; v: string | null; sub?: string; vacio: string }) {
  return (
    <div className="attr">
      <dt>{k}</dt>
      <dd className={v ? undefined : 'attr-vacio'}>
        {v ?? vacio}
        {v && sub && <em>{sub}</em>}
      </dd>
    </div>
  );
}

function CovKpi({
  label, value, share, foot, tone,
}: {
  label: string; value: string; share?: string; foot?: string; tone: string;
}) {
  return (
    <div className="kpi" style={{ ['--kpi-tone' as string]: tone, cursor: 'default' }}>
      <div className="kpi-top"><span className="kpi-label">{label}</span></div>
      <div className="kpi-value num" style={{ color: tone }}>{value}</div>
      {share && <div className="kpi-share">{share}</div>}
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}
