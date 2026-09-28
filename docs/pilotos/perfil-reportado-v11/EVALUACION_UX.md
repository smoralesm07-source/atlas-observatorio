# Perfil del Reportado · Evaluación UX de V10 y piloto V11

**Archivo evaluado:** `perfil_reportado_v10_suite_offline.html`
**Piloto entregado:** `perfil_reportado_v11_offline.html` (esta carpeta; abre con doble clic, sin red)
**Fecha:** 28-09-2026 · **Datos:** ficticios en ambas versiones

---

## 1. Resumen

V10 acierta en la intención: una sola pantalla que integre identidad, ROS, causas, vínculos y
SII, en una aplicación autocontenida con una CSP estricta. Falla en lo que más pesa para un
analista: **encontrar rápido, entender por qué una entidad importa y llegar a la evidencia**.

Los tres problemas de mayor impacto:

1. **El perfil muestra datos de otra entidad.** Al abrir una fila desde la búsqueda masiva solo
   cambian el nombre y el RUT; los KPIs, chips, pestañas, ROS, causas y relaciones siguen siendo
   los de Comercial Andes (`openFromBulk`, línea 130). Es el hallazgo más grave: induce a error.
2. **Buscar es difícil y silencioso.** El buscador es un campo de 290 px en la barra superior,
   no responde a Enter, no valida el dígito verificador, no avisa cuando no encuentra y
   desaparece en pantallas de menos de 720 px. Un N° de ROS lleva a la búsqueda masiva en vez de
   al reporte.
3. **Las alertas no guían.** Las señales son puntos de color de 9 px con texto fijo, sin
   prioridad global, sin la regla que las dispara y sin enlace a la evidencia.

V11 rediseña el flujo completo alrededor de esas tres tareas.

## 2. Método

- Recorrido de las tareas críticas del analista (sección 3) sobre el HTML de V10.
- Heurísticas de usabilidad de Nielsen, con severidad de 0 (cosmético) a 4 (bloqueante).
- Criterios WCAG 2.2 AA relevantes: contraste, uso del color, teclado, tamaño de texto.
- Lectura del código de V10 para confirmar comportamientos (las líneas citadas son del archivo V10).

## 3. Tareas críticas del analista

| # | Tarea | V10 | V11 |
|---|---|---|---|
| T1 | Consultar una entidad por RUT | Campo pequeño, solo con clic en «Buscar», sin validar DV | Buscador central (`Ctrl K` o `/`), Enter, valida DV y explica el resultado |
| T2 | Consultar por N° de reporte | Lleva a búsqueda masiva | Abre la ficha del ROS con sus participantes |
| T3 | Saber por qué la entidad requiere atención | Tres señales fijas en texto de 9 px | Prioridad 0–100 con nivel, reglas visibles y puntos por regla |
| T4 | Ir de la alerta a la evidencia | No existe | «Ver evidencia» desplaza y resalta filas, tarjetas y nodos |
| T5 | Pivotar a un relacionado | «Abrir perfil» no hace nada | Nodos y filas abren el perfil del relacionado |
| T6 | Triar un lote de RUT o ROS | Tabla sin orden; lo no encontrado en rojo | Matriz ordenada por prioridad, filtros por nivel, recorrido con J/K |
| T7 | Saber qué fuentes respaldan el perfil | Vista aparte sin fechas | Cobertura por fuente en cada perfil, con fecha de corte y aviso de desfase |

## 4. Hallazgos

Severidad: 4 bloqueante · 3 grave · 2 moderado · 1 menor.

### 4.1 Integridad de la información

| ID | Hallazgo | Evidencia en V10 | Sev. | Respuesta V11 |
|---|---|---|---|---|
| D1 | Al abrir otra entidad, el resto del perfil sigue mostrando a Comercial Andes | `openFromBulk` solo reescribe `entityName` y `entityRut` | 4 | Todo el perfil se deriva de los registros de la entidad abierta |
| D2 | Cifras que no cuadran: KPI «ROS 11», chip «5 ROS», pestaña con 4 filas; «Familiares 4» y tabla con 1 familiar | Hero, KPIs y `rosRows` son independientes | 3 | Conteos, gráficos y tablas salen de un único registro de ROS y causas |
| D3 | «Tamaño: Mediana» con 126.000 UF y tramo «100.000 a 200.000 UF» (sobre 100.000 UF corresponde Grande) | Pestaña Tributario | 2 | Tamaño calculado desde las ventas del último año |
| D4 | Dos formatos para el mismo identificador de ROS (`ROS-2026-0012` y `100001`) y dos formatos de fecha (`14-09-2026`, `12 mar 2014`) | `rosRows`, `rosDemo`, hechos | 2 | Folio único de 6 dígitos y fecha dd-mm-aaaa en todo el piloto |
| D5 | La vista «Estado de fuentes» no distingue «sin registro» de «no consultada», aunque lo declara | Vista `fuentes` sin estados ni fechas | 2 | Tres estados con glifo propio, por perfil y por fuente |

### 4.2 Búsqueda y navegación

| ID | Hallazgo | Evidencia en V10 | Sev. | Respuesta V11 |
|---|---|---|---|---|
| N1 | El buscador desaparece bajo 720 px | `@media(max-width:720px){.search{display:none}}` | 3 | Buscador siempre visible; en móvil ocupa la barra superior |
| N2 | Enter no busca; solo el botón | Solo `doGlobal.onclick` | 3 | Enter, flechas y atajos `Ctrl K` / `/` |
| N3 | Sin validación de dígito verificador; un RUT mal tipeado se busca igual | `normRut` solo limpia caracteres | 3 | Módulo 11 en vivo, con el DV correcto sugerido |
| N4 | Búsqueda sin resultado no da aviso | `doGlobal` termina sin mensaje | 3 | Mensaje que distingue «RUT válido sin coincidencias» de «RUT inválido» |
| N5 | Diez controles sin acción: Historial, Exportar ficha, Abrir en caso, Copiar RUT, Ver red, Abrir, Abrir ROS, Abrir perfil, «compañeros de causa» y Ver historial de lotes | Botones y enlaces sin manejador | 3 | Cada control visible hace algo; se retiró lo que no existe |
| N6 | Navegación duplicada: el menú lateral lleva a vistas vacías («Vista preparada para evolucionar…») y el contenido real vive en pestañas | Secciones `view-ros`, `view-judicial`, etc. | 3 | Tres destinos reales (Perfil, Lote, Fuentes) y un perfil de lectura continua con índice fijo |
| N7 | Las pestañas ocultan información; no se puede comparar ROS con causas sin alternar | Pestañas `tab-*` | 2 | Secciones continuas con resumen por sección en el índice |
| N8 | En tablet el menú se reduce a letras (P, M, R, ↔, T, J, F, S) poco reconocibles | `@media(max-width:1100px)` | 2 | Iconos con etiqueta; barra inferior en móvil |

### 4.3 Alertas y lectura analítica

| ID | Hallazgo | Evidencia en V10 | Sev. | Respuesta V11 |
|---|---|---|---|---|
| A1 | No hay una prioridad global que ordene el trabajo | KPIs de igual peso | 3 | Indicador semicircular de prioridad 0–100 con nivel |
| A2 | La severidad se codifica solo con color (puntos rojo y ámbar) | `.dot.high`, `.dot.med` | 3 (WCAG 1.4.1) | Forma + color + texto: rombo crítica, triángulo alta, círculo media, anillo baja |
| A3 | Las señales son texto fijo: no dicen qué regla se activó ni cuánto pesa | HTML estático en «Señales prioritarias» | 3 | Cada alerta muestra regla, puntos y detalle con los datos de la entidad |
| A4 | Ninguna señal lleva a su evidencia | Sin enlaces | 3 | «Ver evidencia» resalta filas, tarjetas y nodos; barra para quitar el resaltado |
| A5 | KPIs sin contexto ni acción (sin tendencia, sin clic) | `.kpi` | 2 | Tarjetas con micrográfico, severidad y salto a su sección |
| A6 | Línea de tiempo como lista de años | `timelineBody` | 2 | Cronología por carriles (ROS, ROE, causas, SII) con marca de corte |
| A7 | Relaciones solo en tabla; «Ver red» no existe | `tab-reldet` | 2 | Red radial navegable, tipos de vínculo por trazo y filtro por tipo |

### 4.4 Búsqueda masiva

| ID | Hallazgo | Evidencia en V10 | Sev. | Respuesta V11 |
|---|---|---|---|---|
| B1 | «No encontrado» se pinta como riesgo alto (rojo) | `status high` en filas sin coincidencia | 3 | Incidencias neutras fuera de la matriz; el rojo queda para severidad real |
| B2 | Resultados sin orden ni prioridad | Orden de entrada | 3 | Orden por prioridad, filtros por nivel y columnas ordenables |
| B3 | Cambiar entre «Lista de RUT» y «Lista de ROS» borra el texto pegado sin aviso | Manejador de `.seg button` | 2 | Detección automática por línea: RUT y ROS pueden mezclarse |
| B4 | RUT inválidos se tratan como «no encontrados» | Sin validar DV | 2 | «Por corregir», con botón «Usar 12.345.678-5» |
| B5 | Un ROS del lote muestra solo al reportado; no expande participantes | `rosDemo` con un RUT por ROS | 2 | Cada ROS se expande a todos sus participantes, con el origen visible |
| B6 | El filtro busca dentro de `JSON.stringify` y coincide con nombres de campo (p. ej. «name») | `applyBulkFilter` | 1 | Filtro sobre nombre, RUT, alertas y origen |
| B7 | El CSV omite en silencio las filas no encontradas | `bulkExport` | 1 | Exporta la vista filtrada; las incidencias quedan listadas aparte |

### 4.5 Legibilidad, accesibilidad y robustez

| ID | Hallazgo | Evidencia en V10 | Sev. | Respuesta V11 |
|---|---|---|---|---|
| L1 | Textos de 8 y 9 px en etiquetas, encabezados de tabla, estados y barra de auditoría | `.fact label`, `.tbl th`, `.status`, `.audit` a 8 px | 3 | Mínimo 11,5 px; cuerpo 13–14 px; números tabulares |
| L2 | Sin tema oscuro para jornadas largas | — | 2 | Tema claro y oscuro diseñados por separado, conmutables |
| L3 | Pestañas sin semántica ARIA ni estilos de foco propios | `.tab` | 2 | Foco visible, `aria-pressed`, `aria-current`, diálogos modales con Esc y ciclo de foco |
| L4 | Texto pegado por el usuario se inserta con `innerHTML` sin escapar | `${r.input}` en `applyBulkFilter` | 2 | Todo el contenido dinámico pasa por una función de escape |
| L5 | Nombres internos a la vista: `VW_PERFIL_TRIBUTARIO`, `VW_SENALES_TRIBUTARIAS` | Encabezados de tarjetas | 1 | Lenguaje del analista: «Perfil tributario · corte SII» |
| L6 | La barra de auditoría fija tapa contenido al final de la página | `.audit{position:fixed}` | 1 | Pie de página en flujo y marca «Datos ficticios» en la barra superior y en cada perfil |

## 5. Qué se conserva de V10

- Aplicación autocontenida y sin conexiones externas, con CSP estricta (la versión offline de V11
  mantiene la misma política).
- La idea de un perfil integrado y de señales «explicables».
- Normalización y deduplicación del lote, y exportación CSV con punto y coma.
- La advertencia visible de datos ficticios.

## 6. Principios del rediseño V11

1. **La búsqueda es la puerta.** Un solo buscador reconoce RUT, N° de reporte o nombre, valida y
   explica. Nunca queda oculto.
2. **La severidad ordena la lectura.** El radar de alertas queda fijo a la derecha mientras se
   recorre el perfil: cada alerta es también un atajo a su evidencia.
3. **Toda cifra es trazable.** Conteos, gráficos, tablas y alertas se derivan del mismo registro.
   La prioridad es una suma visible de reglas con sus puntos.
4. **Ausencia no es cero.** Con registro, sin registro y no consultada son tres estados distintos,
   con glifos distintos.
5. **Pivotar sin perder el hilo.** Reporte → participantes → perfil → vínculos → perfil. Desde un
   lote, Anterior y Siguiente (J/K) mantienen el recorrido.
6. **Prioridad de revisión, no imputación.** El indicador ordena el trabajo; no afirma
   responsabilidad ni riesgo LA/FT, y así lo dice en pantalla.

## 7. Componentes del piloto

| Componente | Qué muestra | Por qué ayuda |
|---|---|---|
| Buscador (`Ctrl K` / `/`) | Recientes, mayor prioridad, validación de DV en vivo | Llega a la entidad en segundos y previene errores de tipeo |
| Radar de alertas | Prioridad 0–100, nivel, alertas con regla y puntos, avance de revisión | Resume el porqué y sirve de índice de evidencia |
| Tarjetas de señales | ROS, causas, vínculos, ventas, ROE y RMP con micrográfico y severidad | Lectura de un vistazo; cada tarjeta lleva a su sección |
| Índice fijo de secciones | Severidad y conteo por sección, sección activa | Orienta durante el recorrido largo |
| Cronología por carriles | ROS reportado/vinculado, ROS reciente, ROE por año, causas como barras de duración, hitos SII | Muestra concentración y simultaneidad en el tiempo |
| ROS | Barras apiladas por año, sectores reportantes, tabla con ficha lateral del reporte | Del conteo al detalle y a los otros participantes |
| Causas | Tarjetas con RUC, calidad, etapa, duración y co-intervinientes | Estado vigente destacado; pivote directo |
| Red de vínculos | Grafo radial: forma = tipo de persona, trazo = tipo de vínculo, anillo = prioridad propia, insignias R/J | Hace visible la exposición de la red y permite pivotar |
| Tributario | Ventas con variación interanual, trabajadores, ventas por trabajador contra umbral, actividades | Detecta crecimiento atípico o desproporción |
| Cobertura de fuentes | Estado por fuente y fecha de corte, aviso de desfase | Evita leer una fuente vacía como fuente limpia |
| Búsqueda masiva | Validación en vivo, incidencias con corrección, distribución por prioridad, matriz de señales | Tría cientos de claves y recorre las prioritarias primero |

## 8. Limitaciones del piloto

- Datos, reglas, pesos y umbrales son de ejemplo. Deben calibrarse con el equipo de análisis:
  90 días para «ROS reciente», 30.000 UF por trabajador, pesos de cada regla y cortes de nivel.
- Las listas internacionales figuran como **no consultadas** porque la suite opera sin red.
- «Revisada» y la lista de recientes se guardan solo en el navegador de quien usa el piloto. En
  producción deben persistir en servidor, con usuario y fecha.
- La exportación de ficha es texto plano; un informe formal requiere plantilla institucional.

## 9. Próximos pasos

1. **Prueba con analistas.** Cinco o seis analistas, las seis tareas de la guía del piloto (botón
   «?»). Medir tasa de éxito, tiempo hasta la primera evidencia, errores de ingreso de RUT y SUS.
2. **Calibrar reglas** de prioridad con casos históricos anonimizados.
3. **Conectar datos reales** por sección, un contrato de datos por bloque (ROS, causas, vínculos,
   SII, cobertura), manteniendo la regla de que la pantalla no calcula universos.
4. **Bitácora de consultas.** Registrar quién consultó qué RUT o reporte y cuándo; en un sistema de
   inteligencia financiera la trazabilidad de la consulta es tan importante como la del dato.
5. **Comparar entidades** lado a lado y guardar lotes con nombre como iteraciones siguientes.
