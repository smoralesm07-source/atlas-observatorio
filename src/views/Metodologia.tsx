import { Panel, Semantics, Badge } from '../components/primitives';

/** The methodology view is not documentation for its own sake: an analyst who
 *  cannot state what a number is not should not act on it. */
export function Metodologia() {
  return (
    <div className="fade-in">
      <header className="view-head">
        <h1 className="view-title">Metodología</h1>
        <p className="view-lede">
          Cómo leer lo que este observatorio muestra: qué es una marca, qué es una señal,
          qué significa cada estado de fuente y qué afirmaciones esta herramienta no hace.
        </p>
      </header>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Panel title="Marcas · la unidad de observación">
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.65 }}>
            Una <strong>marca</strong> es una observación estructurada que una fuente
            gobernada sostiene sobre una entidad: un cambio de tramo de ventas, una
            amplitud inusual del historial de domicilios, un evento sancionatorio.
          </p>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Incluida</dt>
            <dd>Aporta a la prioridad analítica de la entidad.</dd>
            <dt>De contexto</dt>
            <dd>Informa la lectura pero no ordena el esfuerzo.</dd>
            <dt>Absorbida</dt>
            <dd>Correlacionada con otra marca; se cuenta una sola vez el fenómeno.</dd>
            <dt>Diagnóstica</dt>
            <dd>Describe la calidad del dato, no la conducta de la entidad.</dd>
            <dt>Disponibilidad</dt>
            <dd>Si la evidencia que la marca requiere está o no presente en el corte.</dd>
          </dl>
        </Panel>

        <Panel title="Señales · la superficie de anticipación">
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.65 }}>
            Una <strong>señal</strong> es un patrón que se activa sobre el conjunto, no
            sobre una entidad aislada: recurrencia sancionatoria, convergencia de tres o
            más fuentes, concentración territorial, silencio persistente de reportes.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            <SignalRow p="MUY ALTA" d="El patrón es nítido y su intensidad está en el extremo del corte." />
            <SignalRow p="ALTA" d="El patrón es claro y sostiene una revisión dirigida." />
            <SignalRow p="MEDIA" d="El patrón existe pero admite explicaciones alternativas." />
            <SignalRow p="OBSERVAR" d="Vale la pena mirarlo en el próximo corte antes de actuar." />
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            La prioridad la declara el productor del patrón. Esta interfaz la muestra, no
            la recalcula.
          </div>
        </Panel>
      </div>

      <Panel title="Cómo busca el Observatorio una entidad">
        <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.65 }}>
          La búsqueda no es una consulta, son tres capas con autoridad distinta. El
          Observatorio recorre la primera siempre y sigue solo hacia la segunda cuando la
          primera no sabe nada. La tercera se consulta cuando la pides.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <Capa
            n="1"
            titulo="Universo observado"
            que="Las 50 mil entidades que las fuentes gobernadas reportan: padrón UAF, actividad SII, universo OSFL, eventos sancionatorios y menciones de prensa."
            vale="Es la única capa con identidad trabajada. Un resultado aquí tiene RUT, territorio, historia y prioridad analítica —salvo los que llevan el marcador «identidad sin resolver»."
          />
          <Capa
            n="2"
            titulo="Listas internacionales y bases offshore"
            que="OFAC, ONU, Unión Europea, Reino Unido, Banco Mundial, BID, OpenSanctions e ICIJ Offshore Leaks, consultadas en vivo."
            vale="Devuelve candidatos por nombre, no coincidencias acreditadas. Nada se persiste ni promueve identidad. Los homónimos y las transliteraciones son frecuentes: la atribución la decide el analista contra la fuente original."
          />
          <Capa
            n="3"
            titulo="Identidad digital"
            que="El nombre se resuelve en variantes de username explicables, se barren plataformas con varios motores y se profundizan los mejores candidatos."
            vale="Mide convergencia técnica, no identidad. Un alias con señal es una hipótesis para corroborar contra contenido, bio, ubicación y enlaces cruzados."
          />
        </div>
        <div className="note" style={{ marginTop: 16 }}>
          Las capas nunca se mezclan en una misma lista. Un candidato de OFAC y una entidad
          del padrón UAF no son objetos comparables, y presentarlos juntos invitaría a
          tratarlos igual.
        </div>
      </Panel>

      <div className="grid grid-2" style={{ margin: '16px 0' }}>
        <Panel title="Estados de fuente · qué afirma cada uno">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <StatusRow tone="present" label="Con registro">
              La fuente fue consultada y tiene registros de esta entidad.
            </StatusRow>
            <StatusRow tone="absent" label="Sin registro">
              La fuente fue consultada y no reporta a esta entidad. No es un descarte:
              la entidad puede estar fuera del alcance de esa fuente.
            </StatusRow>
            <StatusRow tone="unknown" label="No consultada">
              Nadie preguntó todavía. El observatorio no afirma presencia ni ausencia.
              Las listas internacionales y las consultas OSINT operan así.
            </StatusRow>
          </div>
          <div className="note" style={{ marginTop: 15 }}>
            Esta distinción es el corazón del diseño: la ausencia de una fuente es
            ausencia de dato, nunca un cero.
          </div>

          <h4 style={{ margin: '20px 0 10px', fontSize: 12.5 }}>Identidad sin resolver</h4>
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.6 }}>
            Algunas entidades llegan desde prensa como un nombre que nunca se resolvió a
            un RUT. Se muestran porque la mención existe, pero llevan el marcador{' '}
            <em>identidad sin resolver</em>: pueden ser una razón social real, un nombre
            genérico o una entidad distinta que se llama parecido. No las trates como
            identificadas hasta que otra fuente las confirme.
          </p>
        </Panel>

        <Panel title="Índices · qué ordenan y qué no">
          <dl className="kv">
            <dt>IPA3 · Prioridad analítica</dt>
            <dd>
              Ordena el esfuerzo de análisis entre entidades del mismo corte. No es
              probabilidad de LA/FT ni imputación de incumplimiento.
            </dd>
            <dt>IPF · Priorización fiscalizadora</dt>
            <dd>
              Ordena esfuerzo de fiscalización sobre sujetos obligados inscritos.
              Su tasa sancionatoria describe lo publicado por la UAF, no la conducta
              agregada del sector.
            </dd>
            <dt>Percentil de pares</dt>
            <dd>
              Posición dentro del grupo de pares del año comercial. No es desempeño
              ni riesgo.
            </dd>
            <dt>Cobertura</dt>
            <dd>
              Cuánta de la evidencia requerida está disponible. Una prioridad baja con
              cobertura baja significa «no sabemos», no «está bien».
            </dd>
          </dl>
        </Panel>
      </div>

      <Panel title="Qué es y qué no es este observatorio">
        <div className="grid grid-2" style={{ gap: 20 }}>
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--present)' }}>Es</h4>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.75 }}>
              <li>Un monitor de fuentes abiertas gobernadas.</li>
              <li>Un buscador que responde qué sabemos de una entidad y desde qué fuente.</li>
              <li>Una superficie de anticipación de patrones y anomalías.</li>
              <li>Un apoyo al análisis, con la metodología a la vista.</li>
            </ul>
          </div>
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--sig-critical)' }}>No es</h4>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.75 }}>
              <li>Un expediente ni un sistema de gestión de casos.</li>
              <li>Una asignación de tareas a fiscalizadores.</li>
              <li>Un ROS, una denuncia ni una decisión institucional.</li>
              <li>Una fuente de verdad sobre entidades: eso son las fuentes originales.</li>
            </ul>
          </div>
        </div>
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Semantics>
          <strong>Universos distintos permanecen explícitos.</strong> El observatorio
          puede conectar fuentes analíticamente sin pretender que sus montos, poblaciones
          o granos sean directamente comparables. Ejecución presupuestaria no es compra
          pública; padrón UAF no es universo económico; mención en prensa no es hecho
          acreditado.
        </Semantics>
      </div>
    </div>
  );
}

function Capa({ n, titulo, que, vale }: { n: string; titulo: string; que: string; vale: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '30px minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
      <div
        className="num"
        style={{
          width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center',
          background: 'var(--accent-glow)', color: 'var(--accent)', fontWeight: 700,
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        }}
      >
        {n}
      </div>
      <div>
        <div style={{ fontWeight: 650, fontSize: 13.5, letterSpacing: '-0.012em' }}>{titulo}</div>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>{que}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>{vale}</p>
      </div>
    </div>
  );
}

function SignalRow({ p, d }: { p: string; d: string }) {
  const tone = p === 'MUY ALTA' ? 'critical' : p === 'ALTA' ? 'high' : p === 'MEDIA' ? 'medium' : 'watch';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
      <Badge tone={tone as 'critical'} dot>{p}</Badge>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{d}</span>
    </div>
  );
}

function StatusRow({
  tone, label, children,
}: {
  tone: 'present' | 'absent' | 'unknown'; label: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '124px minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
      <Badge tone={tone}>{label}</Badge>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}
