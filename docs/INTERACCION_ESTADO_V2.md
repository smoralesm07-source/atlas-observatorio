# ATLAS · Interacción con el Estado v2

## Objetivo

Rediseñar el actual módulo de gasto público para que Mercado Público deje de tener como foco principal la detección de anomalías y pase a ser una capa de consulta por entidad, complementada por Presupuesto Abierto.

La pantalla debe responder, para cualquier RUT consultable:

1. ¿Es o ha sido proveedor del Estado?
2. ¿Desde cuándo y hasta cuándo se observa actividad?
3. ¿A qué organismos les ha vendido?
4. ¿Cuánto les ha vendido y en qué períodos?
5. ¿Cuántas órdenes de compra se observan?
6. ¿Cuál es su principal comprador y cómo evoluciona la relación?
7. ¿Ha recibido pagos/recursos del Estado según Presupuesto Abierto?
8. ¿Cuándo, cuánto y desde qué organismo?
9. ¿Cuál es su principal pagador?
10. ¿Qué OC, documentos o evidencia explican el resumen?

Compras públicas y ejecución presupuestaria se mantienen como universos distintos. No se suman sus montos.

## Decisión temporal

No se elimina historia anterior a 2020 en la fuente.

La experiencia por defecto usará `2020 → actualidad`, porque es el período de mayor utilidad operativa y permite que las consultas iniciales y agregados permanezcan pequeños. La historia anterior a 2020 queda disponible mediante `Toda la historia` y se carga sólo a demanda.

Esto evita tomar una decisión irreversible antes de medir el costo real del histórico. Si el índice completo demuestra un costo marginal bajo, la UI podrá pasar posteriormente a `Toda la historia` como valor por defecto sin rediseñar el contrato.

Principio: **conservar todo; precalcular lo reciente; expandir lo histórico a demanda**.

## Arquitectura de consulta

### Capa 0 · Directorio

Índice compacto por RUT y nombre. Debe incluir el universo completo de proveedores, no sólo los actores priorizados por el monitor.

Campos mínimos:

- `supplier_id` (RUT normalizado)
- `supplier_label`
- `first_seen`
- `last_seen`
- `is_state_supplier`
- `has_pre2020_history`
- `has_budget_evidence`

Debe responder la búsqueda/autocompletado sin tocar órdenes individuales.

### Capa 1 · Resumen por entidad

Carga inmediata al seleccionar un RUT.

Para Mercado Público:

- primera y última operación observada
- monto total observado en el período
- cantidad de OC
- cantidad de organismos compradores
- principal comprador
- monto y participación del principal comprador
- meses/años activos

Para Presupuesto Abierto:

- primera y última evidencia
- devengado observado
- pagado observado cuando esté disponible en el contrato de fuente
- cantidad de organismos pagadores/receptores
- principal organismo

El resumen debe declarar período y cobertura de cada fuente.

### Capa 2 · RUT × organismo × año

Es la capa principal de navegación. Evita consultar el detalle transaccional para responder la mayoría de las preguntas.

Mercado Público:

`rut | buyer_id | buyer_label | year | amount_clp | order_count | first_seen | last_seen`

Presupuesto Abierto:

`rut | institution | year | accrued_clp | paid_clp | document_count | first_seen | last_seen`

Esta capa permite responder rápidamente quién compra/paga, cuánto y cuándo, además de construir la serie temporal.

### Capa 3 · Operaciones a demanda

Sólo se consulta cuando el usuario abre `Ver operaciones`.

Filtros obligatorios:

- RUT
- desde/hasta
- organismo opcional
- paginación

Campos deseables para Mercado Público:

- código OC
- fecha
- organismo comprador
- proveedor
- monto
- estado
- tipo/procedencia de compra cuando exista
- licitación asociada cuando exista
- descripción/producto cuando la fuente lo permita

Para Presupuesto Abierto:

- fecha/período
- organismo/servicio/área
- proveedor/receptor
- devengado
- pagado
- documento
- OC cuando exista

Nunca descargar o materializar todo el libro mayor en el navegador.

## Contrato core → Atlas

El exportador analítico existente (`ps_export_for_observatory`) se conserva para el monitor actual. No se reutiliza su ranking ni su cap de 3.000 como mecanismo de búsqueda.

Se agrega un contrato separado orientado a entidad:

- `entity_search(q, limit)`
- `entity_summary(rut, from_year=2020, to_year=current)`
- `entity_buyers(rut, from_year=2020, to_year=current)`
- `entity_timeline(rut, from_year=2020, to_year=current)`
- `entity_orders(rut, from, to, buyer_id?, limit, offset)`

Regla de seguridad: el RUT es obligatorio para detalle. No se habilita un endpoint que permita descargar todas las OC desde Atlas.

## Índices

El diseño requiere índices por identidad y temporalidad, no por anomalía/prioridad:

- proveedor: `(snapshot_id, supplier_id)`
- par: `(snapshot_id, supplier_id, buyer_id)`
- agregado anual: `(supplier_id, year, buyer_id)`
- detalle OC: `(supplier_id, order_date desc)` y, si se usa con frecuencia, `(supplier_id, buyer_id, order_date desc)`

No se debe ordenar la consulta de entidad por `review_priority`.

## UX

Nueva vista: **Interacción con el Estado**.

Entrada:

`Buscar por RUT o nombre`

Resultado de cabecera:

- nombre / RUT
- `Proveedor del Estado` Sí/No
- `Receptor de fondos públicos` Sí/No
- cobertura Mercado Público
- cobertura Presupuesto Abierto

Bloques:

1. **Compras públicas** — ventas observadas al Estado.
2. **Recursos públicos recibidos** — ejecución observada en Presupuesto Abierto.
3. **Evolución** — serie anual, manteniendo separadas ambas fuentes.
4. **Organismos** — compradores y pagadores.
5. **Operaciones** — detalle bajo demanda.

Filtros rápidos:

- `2020–actualidad` (predeterminado)
- `Últimos 5 años`
- `Toda la historia`
- rango personalizado

## Tratamiento del histórico pre-2020

Antes de excluirlo se debe medir:

- número de OC y proveedores por año
- tamaño de la capa anual agregada
- latencia p50/p95 de `entity_summary` y `entity_buyers`
- latencia de detalle para proveedores de alta actividad

Criterio propuesto: si incluir toda la historia mantiene la consulta de resumen/indexada dentro de una experiencia interactiva y el agregado anual no genera una huella material frente al dataset actual, conservar todo como default. En caso contrario, 2020+ continúa como default y el histórico se consulta a demanda.

No usar el tiempo de descarga del bulk como criterio para la UI: el usuario consulta índices/agregados, no el bulk.

## Lo que deja de ser central

La nueva vista no presenta como información principal:

- severidad
- hallazgos
- precio atípico
- aceleración
- convergencia
- prioridad de revisión

Estos cálculos pueden sobrevivir en el monitor analítico existente, pero no condicionan que una entidad aparezca ni el orden de sus operaciones.

## Criterios de aceptación

Un RUT fuera de los 3.000 actores priorizados debe ser localizable si existe en el universo de Mercado Público.

La consulta inicial no debe requerir cargar órdenes individuales.

Cambiar de 2020+ a toda la historia no debe cambiar la identidad del proveedor; sólo ampliar período, montos, organismos y operaciones.

Cada cifra debe declarar fuente y período.

Mercado Público y Presupuesto Abierto nunca se presentan como si sus montos fueran directamente sumables.
