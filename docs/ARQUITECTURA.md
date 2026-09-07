# Arquitectura del Observatorio

## Por qué una app nueva y no una versión más de ATLAS

ATLAS funciona, pero su runtime creció por acumulación: más de doscientos
archivos versionados (`v016` … `v0527`) cargados por orden de aparición, con
capas sucesivas de *fix*, *hardening* y *authority* compitiendo por el control de
la misma ruta. Cada corrección nueva tiene que negociar con las anteriores.

El Observatorio no reescribe ATLAS ni lo toca. Toma los mismos datos gobernados y
los expone por un camino distinto y corto:

```
FUENTES GOBERNADAS  →  obs_refresh_all()  →  obs_*  →  contratos RPC  →  app
```

Un único escritor, cinco contratos, una app con build. No hay capas de
autoridad en competencia porque no hay dos caminos hacia el mismo dato.

## Dónde viven los read models

En el mismo proyecto Supabase que las tablas Fusion (`aml_entities`,
`aml_findings`, `aml_pattern_alerts`, `aml_sanctions`, padrón UAF, OSFL, IPA3).

La razón es operativa: ahí está el universo de entidades, así que la
materialización es `INSERT … SELECT` puro. Ubicarlos en otro proyecto habría
exigido un ETL entre proyectos, credenciales cruzadas y una copia de 50 mil
entidades que se puede desincronizar. Además, la app usa un solo cliente y una
sola sesión, en vez del intercambio federado de sesión que ATLAS necesita hoy.

Esto es seguro porque las migraciones son estrictamente aditivas: sólo crean
objetos con prefijo `obs_`. Ningún objeto de ATLAS se altera, renombra ni
elimina, y ninguna ruta actual cambia de comportamiento.

## Las cinco reglas

1. **Calcular, publicar, mostrar.** El trabajo pesado ocurre una vez cada seis
   horas en `obs_refresh_all()`. Ninguna pantalla lo repite. Un corte declara
   `snapshot_id`, `row_counts` y `published_at`; si no termina en `READY`, no se
   publica. La función es transaccional: una corrida cancelada a mitad de camino
   deja intacto el corte anterior, verificado provocando una cancelación real.
2. **Una pantalla consume un contrato.** `obs_pulse`, `obs_search_entities`,
   `obs_entity_detail`, `obs_alert_feed`, `obs_source_status`. Cambiar la forma
   de un contrato exige una versión nueva; las tablas `obs_*` no son API.
3. **La autorización no se degrada.** Contratos `SECURITY INVOKER` sobre RLS
   ligado a `aml_allowed_users`. Verificado: un usuario autenticado fuera de la
   lista lee cero filas y la ficha devuelve `null`. `anon` no tiene `EXECUTE`.
4. **La ausencia de una fuente es ausencia, nunca un cero.** `obs_entity_source`
   guarda sólo filas `PRESENT`; el estado `ABSENT` o `NOT_CONSULTED` se deriva al
   leer, contra el catálogo de fuentes. Por eso la ficha distingue *sin registro*
   (se preguntó, no aparece) de *no consultada* (no se preguntó).
5. **Universos distintos permanecen explícitos.** El observatorio conecta
   fuentes sin pretender que sus montos, poblaciones o granos sean comparables.

## Búsqueda de entidades

Es la operación primaria, así que tiene su propio diseño:

- `name_search` guarda el nombre en minúsculas, sin acentos ni puntuación, con
  índice GIN trigram.
- `rut_search` guarda el RUT reducido a dígitos y DV, con índice de prefijo. Lo
  escribe la propia materialización, no un backfill posterior: un corte publicado
  con el índice de RUT vacío rompería la búsqueda en silencio.
- La función decide primero **qué le escribieron**. Si la consulta es
  mayoritariamente numérica se resuelve por el índice de RUT; si no, por trigram.
  Cuando ambos predicados vivían en un mismo `OR`, el planificador recorría las
  50 mil filas ejecutando una expresión regular por fila: 960 ms. Separadas por
  rama: 134 ms.
- Resuelven todas las formas de escribir un RUT: `97.080.000-K`, `97080000-K`,
  `97080000-k`, `97080000` y prefijos parciales.

## Identidad: Entra, no contraseñas

ATLAS autentica con Microsoft Entra (`signInWithOAuth({ provider: 'azure' })`).
Las cuentas del padrón no tienen contraseña: `encrypted_password` está en NULL.
Una pantalla de correo y contraseña habría sido inutilizable para los usuarios
reales, así que el Observatorio usa exactamente el mismo flujo, con
`detectSessionInUrl` activo para recibir la sesión de vuelta desde el redirect.

De ahí que existan tres pantallas y no dos: sin sesión, sesión sin habilitación,
y sesión habilitada. Autenticarse no es autorizarse, y la interfaz lo dice en
lugar de dejar que el analista choque contra un error de permisos.

## Por qué la agenda vive en la base y no en CI

`obs_refresh_all()` tarda unos 25 s sobre 50 mil entidades. PostgREST conecta
como el rol `authenticator`, que impone `statement_timeout` de 8 s, y ese límite
lo hereda `service_role`. Un job de CI que llamara la RPC habría fallado en cada
corrida.

Fijar el timeout dentro de la función tampoco sirve: el temporizador se arma
cuando la sentencia de nivel superior empieza y no se re-arma al cambiar el
ajuste a mitad de ejecución. Se verificó ejecutando la función bajo una sesión
con límite de 8 s: se canceló igual.

La materialización es trabajo interno de la base, así que la agenda es de la
base. `pg_cron` ya sostiene los demás refrescos de ATLAS, de modo que esto no
introduce un mecanismo nuevo, no necesita secretos y no expone una operación de
escritura por la API pública. CI queda como vigilante: comprueba frescura, el
estado del último intento y que la agenda siga activa.

## La cascada de búsqueda

ATLAS resolvía una entidad recorriendo `canónico → prensa sin reconciliar →
OSINT externo`. El Observatorio conserva esa capacidad y la simplifica, porque
las observaciones de prensa ya viven en `aml_entities` y por tanto en
`obs_entity`: ahí se distinguen con el marcador *identidad sin resolver* en vez
de necesitar una etapa aparte.

Quedan tres capas, con autoridad explícitamente distinta:

1. **Universo observado** — `obs_search_entities`. Automática.
2. **Listas internacionales** — `aml-entity-global-watchlists-live`. Se dispara
   sola cuando la capa 1 devuelve cero, o a petición.
3. **Identidad digital** — `aml-digital-identity-resolver-live` y
   `aml-digital-identity-deep`. Siempre a petición.

Las funciones de borde ya existían y las usa ATLAS: el Observatorio las consume
tal cual, sin reimplementarlas. Son la misma autoridad y los mismos guardrails.

La regla que ordena la presentación es que **las capas no se mezclan**. Un
candidato por nombre en OFAC y una entidad del padrón UAF no son objetos
comparables; ponerlos en una misma lista invitaría a tratarlos igual. Cada capa
declara qué fuentes respondieron, cuáles no y por qué —«no respondió», «sin
credencial», «cuota agotada»— para que el silencio de una fuente nunca se lea
como ausencia de riesgo.

Desde la ficha el screening es mejor que desde el buscador: ahí hay RUT y tipo
de entidad, así que OpenSanctions puede cruzar por número tributario y no sólo
por nombre.

## Territorio: gobernar un indicador que vivía en el navegador

El IGR es el indicador territorial de ATLAS. Su versión vigente es
**IGR v2A (`IGR-2A-1.0.0`, efectiva el 26-08-2026)**: `100% amenaza territorial
CEAD-LA`. La v4 que sigue almacenada en `aml_beta_territory_igr_snapshot_v4`
está **retirada** y no se usa aquí; leerla habría resucitado una autoridad
muerta, que es justamente lo que hace ilegible al ATLAS actual.

En ATLAS el IGR v2A lo descarga el **navegador** desde un JSON crudo de GitHub y
se muestra dentro de un **iframe**: sin read model, sin identidad de corte y sin
RLS. El Observatorio lo trae desde la base con la extensión `http`, lo
materializa en `obs_territory` con el mismo `snapshot_id` que el resto del corte
y lo publica como contrato.

El contrato del indicador excluye explícitamente del cálculo la vulnerabilidad
sectorial, la densidad de sujetos obligados, la brecha de cobertura, ICR, IRAR,
IPA, IVO y las sanciones de entidad. Esas cifras se publican **al lado** del IGR
—las columnas se llaman `ctx_*`— y la interfaz dice que son descriptivas. La
agregación regional es media comunal ponderada por confianza, de modo que una
comuna mal cubierta no arrastra a su región, y la confianza se publica separada
del score porque *menor cobertura no es menor riesgo*.

La cobertura real se declara arriba, no en una nota al pie: hoy la capa de
amenazas precedentes está materializada con delitos de drogas, y fraude,
corrupción, delitos económicos, contrabando y crimen organizado **no** se
presentan como si tuvieran cobertura territorial suficiente.

Si la fuente CEAD no responde, la corrida no falla: `obs_refresh_territory`
devuelve `-1`, conserva lo ya publicado y el corte lo declara en `row_counts`.

## Sectores obligados

`obs_sector` cruza el padrón UAF por sector con la vulnerabilidad estructural de
referencia y los giros característicos observados. Tres indicadores distintos
que la interfaz no deja confundir: la **vulnerabilidad** describe el modelo de
negocio, el **IPF** ordena esfuerzo de fiscalización sobre inscritos, y la
**tasa sancionatoria** describe lo que la UAF ha publicado.

**IRAR-E** —el riesgo inherente sectorial— tiene fórmula gobernada pero sus
insumos no están materializados. El Observatorio lo dice en lugar de mostrar un
número inventado.

## Gasto público y compras: dos universos que no se suman

`obs_spend_*` publica el corte de compras públicas y `obs_budget_signal` el de
ejecución presupuestaria. **No se agregan nunca en una sola cifra.** Compras
describe la relación entre un organismo comprador y un proveedor en ChileCompra,
con grano de par y ventana de 12 meses; ejecución describe el devengo del
organismo. Un total combinado no describiría ninguna población real, así que la
pantalla los separa en dos bloques con encabezado propio y el contrato lo dice
en su propia `semantics`.

### El puente entre proyectos

Las métricas de compras las calcula el pipeline de perfilado, que vive en el
proyecto core de ATLAS. Darle al navegador una segunda sesión contra ese
proyecto habría duplicado la superficie de autorización, así que el puente es
**servidor a servidor**: `obs_bridge_fetch()` llama por HTTP a
`ps_export_for_observatory()` con un token guardado en Vault en los dos
proyectos, comparado en tiempo constante del lado del core. El navegador nunca
ve el token ni la URL del otro proyecto, y el objeto del lado core —lo único que
el Observatorio agrega a ATLAS— está versionado en
`supabase/core-project/0001_ps_export_for_observatory.sql`: una función de sólo
lectura y un índice, sin tocar ninguna tabla, vista ni función existente.

El mismo tope de 8 s de PostgREST que expulsó la materialización hacia `pg_cron`
gobierna aquí la paginación. La sección de pares tardaba 3,8 s por página de 500
porque el `order by review_priority desc nulls last` no coincidía con un índice
`desc` —que en btree es `desc nulls first`— y caía en un *seq scan* sobre
494.867 filas; el puente moría con `HTTP_500`. Con `ps_pair_metric_export_idx`,
que ordena exactamente igual que el exportador, la misma página cuesta 56 ms.

### Topes deliberados, escritos en el corte

Los hallazgos se traen completos porque son la superficie analítica. Actores y
pares se acotan a 3.000 por prioridad de revisión: de 72.802 proveedores y
494.867 pares del universo, el Observatorio publica lo que se mira, no el libro
mayor. Los topes y el recuento real quedan en `obs_spend_snapshot.ingested`
junto a los errores del último traspaso, y la vista los declara en la pantalla
en vez de dejar creer que 3.000 es el universo. Cuando se abre un actor cuyos
pares quedaron fuera del tope, la ficha lo dice: *«que no aparezca aquí no
significa que no tenga compras públicas»*.

### El proveedor casi nunca tiene nombre

La fuente publica razón social para 39 de 72.802 proveedores. El refresco
rellena la etiqueta primero desde el universo observado —el `actor_id` **es** un
RUT, así que el cruce contra `obs_entity` es exacto y no por nombre— y después
desde las etiquetas que sí vienen en los pares. Eso lleva a los compradores de
234 a 840 nombres y a los proveedores a 89. Lo que queda sin nombre se muestra
con su RUT formateado, nunca como un guión, y desde ahí se puede abrir la ficha
de observación o la búsqueda en cascada sobre ese mismo RUT.

Sólo 88 de 3.000 proveedores resuelven a una entidad del universo observado. No
es una falla de cobertura: la mayoría de los proveedores del Estado no es sujeto
obligado. La pantalla lo dice así, para que un número bajo no se lea como un
error.

### Hipótesis con estado, no hipótesis simuladas

`ps_readiness` viaja íntegro dentro del corte. De las diez hipótesis del
pipeline, seis están disponibles o parciales y cuatro declaran `REQUIRES_SOURCE`
con las fuentes que les faltan —fragmentación de compras, redes de oferentes,
trazabilidad OC↔devengo y perfil de proveedor—. La vista las muestra igual, con
su estado y su explicación: la ausencia de un hallazgo en esas familias es un
vacío de datos declarado, no un resultado negativo.

Las audiencias de lobby se excluyen del read model: 52.548 registros que llegan
sin comprador, sin proveedor y sin monto. Publicarlas junto a señales con
materialidad las habría hecho parecer equivalentes.

## Color: una rampa secuencial, no el semáforo de las señales

El nivel de IGR es una escala **ordenada de magnitud**, no un estado, así que no
reutiliza los colores de prioridad de las señales: usa una rampa de un solo tono
con luminosidad monótona, con pasos propios para cada tema —en superficie oscura
la magnitud crece con la luminosidad, y no es una inversión automática de la
rampa clara. Los pasos bajos no alcanzan 3:1 contra la superficie, de modo que
todo uso lleva siempre el nombre del nivel como texto: el color nunca es la
única codificación.

Por la misma razón, los pesos de composición del índice se pintan con color
constante: el semáforo por umbral leería un peso de 10% como «malo», y un peso
no se juzga. Y los puntajes de capa usan la rampa del IGR, porque un 95 de
amenaza pintado de verde diría lo contrario de lo que significa.

## Verificación

- **Contratos y autorización**: en la base, simulando el rol `authenticated` con
  los claims de un analista habilitado y de uno que no lo está.
- **Render**: `tests/render.mjs` levanta el bundle construido, intercepta las
  llamadas RPC con payloads reales capturados de los contratos vivos, y recorre
  las ocho vistas, las pestañas de la ficha, el tema claro, el ancho de teléfono
  y los tres estados de acceso. Incluye una guarda de regresión contra el
  defecto de autenticación: si vuelve a aparecer un campo de contraseña en la
  pantalla de ingreso, la prueba falla.
- **Cascada**: la prueba fuerza una consulta que el universo no conoce y
  verifica que el salto a listas internacionales ocurre solo, con su encuadre y
  con el estado real de cada fuente.
- **Territorio y sector**: el detalle comunal se verifica descomponiendo capas y
  componentes (intensidad, persistencia, tendencia, anomalía), y el sectorial
  abriendo giros, bandas de IPF y distribución territorial.
- **Gasto público**: el doble de la RPC respeta el filtro por familia y
  recalcula el total, para que la prueba del filtro pruebe algo; se verifica que
  el filtro viaje en la URL, que un proveedor sin razón social siga siendo
  navegable por su RUT y que un actor fuera del tope de 3.000 lo declare en vez
  de mostrar una ficha vacía.
- **Agenda**: verificada programando el mismo comando cada minuto y leyendo
  `cron.job_run_details`: cinco corridas consecutivas exitosas, de 18 a 19 s.

## Relevancia de la búsqueda

La similitud trigram por sí sola premiaba nombres cortos y genéricos: buscar
«banco» devolvía primero «Bancos», una mención de prensa sin RUT y con una sola
fuente, por delante de BANCO BICE, que tiene RUT, cuatro fuentes y un evento
sancionatorio. El orden agrupa la similitud en tramos de 0,1 y, dentro de cada
tramo, decide la fuerza de la identidad: primero la resuelta con RUT, luego la
respaldada por más fuentes.

2.973 entidades del universo llegan desde prensa sin identidad resuelta a un
RUT. No se ocultan —la mención existe— pero llevan el marcador *identidad sin
resolver*, porque tratarlas como entidades identificadas sería el error más caro
que puede cometer esta herramienta.

## Lo que falta conectar

`RADAR_CGR`, `RADAR_DELICTUAL`, `MERCADO_PUBLICO` y `PRESUPUESTO_ABIERTO` están
declarados en el catálogo de fuentes pero todavía no aportan vínculos por
entidad en la ficha: la interfaz los muestra honestamente como *en silencio* en
lugar de omitirlos. (CGR y Presupuesto Abierto sí alimentan la sección de gasto
público, con grano de organismo en vez de grano de entidad.) Conectarlos consiste en que sus productores escriban `entity_id` en el
perfil Fusion; el Observatorio los recoge en el corte siguiente sin cambios de
código.

Las listas internacionales (OFAC, ONU, UE, Reino Unido, Banco Mundial, BID,
OpenSanctions) y las herramientas OSINT operan bajo demanda por entidad. Hoy la
ficha las declara como *no consultadas*; el siguiente paso es ejecutarlas desde
la ficha y persistir el resultado como una fila `PRESENT` o `ABSENT` con su
fecha de consulta.
