"""Radar de economías criminales digitales.

Recolectores de fuentes abiertas que informan sobre mercados ilícitos que se
anuncian en la dark web y en canales similares (sitios de filtración de
ransomware, catálogos de foros y mercados, bases de phishing, listas de
direcciones cripto sancionadas, alertas de reguladores).

Principio rector: el radar registra el HECHO de una exposición —quién aparece,
dónde, cuándo, de qué tipo— y nunca el CONTENIDO filtrado. No descarga dumps,
no visita sitios .onion, no guarda datos de personas naturales.
"""

SCHEMA = "radar.snapshot.v1"
