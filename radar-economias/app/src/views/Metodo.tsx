import type { Snapshot } from '../types';

export function Metodo({ snap }: { snap: Snapshot }) {
  return (
    <div className="view prose">
      <section className="card">
        <h3>Qué es</h3>
        <p>
          Un radar de los mercados ilícitos que se anuncian en la dark web y en canales similares, leído desde la
          pregunta de LA/FT: <b>qué economías criminales tocan a entidades y mercados chilenos, y por qué rieles del
          sistema financiero podría entrar o salir su dinero</b>. Esos rieles son sujetos obligados o candidatos a
          serlo, y ahí está el puente con ATLAS.
        </p>
      </section>

      <section className="card">
        <h3>Reglas</h3>
        <ol>
          <li><b>El hecho, nunca el contenido.</b> Se registra quién aparece, dónde, cuándo y de qué tipo. No se
            descargan filtraciones, no se visitan sitios .onion ni dominios de phishing, no se guardan direcciones de
            acceso a mercados ni enlaces de invitación.</li>
          <li><b>Sin datos de personas naturales.</b> Las brechas se leen por servicio, no por correo. Los canales
            de Telegram quedan desactivados hasta contar con informe jurídico (Ley 21.459 art. 6 y Ley 21.719).</li>
          <li><b>Una publicación criminal no es un hecho probado.</b> Una reivindicación no confirma un incidente; un
            dominio de phishing no prueba un fraude consumado.</li>
          <li><b>La ausencia de una fuente es ausencia, nunca un cero.</b> Si ninguna fuente de una economía
            respondió, la economía se muestra «sin lectura».</li>
          <li><b>Calcular, publicar, mostrar.</b> Cada corte tiene identidad ({snap.snapshot_id}), huella del
            contenido leído por fuente y lista de hechos nuevos respecto del corte anterior.</li>
          <li><b>Lo externo es candidato.</b> Nada de este radar modifica la prioridad analítica de una entidad en
            ATLAS: al integrarse será una capa aparte en la ficha, igual que las listas internacionales.</li>
        </ol>
      </section>

      <section className="card">
        <h3>Economías y su lectura LA/FT</h3>
        <dl className="eco-dl">
          {Object.entries(snap.economies).map(([k, e]) => (
            <div key={k}>
              <dt>{e.label}</dt>
              <dd>{e.laft}<small>Riel: {e.rail}</small></dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card">
        <h3>Camino de integración con ATLAS</h3>
        <ol>
          <li>El corte pasa de JSON a un proyecto Supabase propio con las tablas <code>rad_*</code>
            (<code>radar-economias/supabase/</code>), con el mismo modelo de fuentes y estados que
            <code> aml_external_source_health</code>.</li>
          <li>El catálogo de marcas se reemplaza por el universo de proveedores de pago de ATLAS (CMF, SII, PSP), para
            que cada marca suplantada llegue con su RUT.</li>
          <li>ATLAS consume dos contratos por un puente servidor a servidor, como el de compras públicas:
            <code> rad_entity_exposure(rut, dominio)</code> para la ficha de entidad y
            <code> rad_economy_overview()</code> para el panel sectorial.</li>
          <li>El login usa Microsoft Entra y la misma lista de usuarios habilitados.</li>
        </ol>
      </section>
    </div>
  );
}
