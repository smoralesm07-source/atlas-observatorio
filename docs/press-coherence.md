# Coherencia de prensa por entidad

Entidad 360 y Huella pública deben resolver la relación de una entidad con Radar Prensa mediante `src/lib/entityPress.ts`.

- La búsqueda parte por razón social y usa RUT como respaldo.
- La pertenencia al expediente acepta RUT exacto o coincidencia de nombre con el umbral histórico de Entidad 360.
- Las noticias se clasifican como `directa`, `contexto` o `revision` con la misma semántica en las vistas de entidad.
- Una coincidencia periodística acredita una publicación asociada, no la veracidad del hecho ni responsabilidad de la entidad.
- La marca `PRESS` del constructor de muestras es deliberadamente más estricta: depende de enlaces materializados y resueltos en `atlas_press_entity_link`, por lo que la interfaz la denomina **Prensa resuelta**.

Este contrato evita que Huella pública informe “sin prensa” cuando Entidad 360 ya mantiene noticias asociadas a la misma entidad.
