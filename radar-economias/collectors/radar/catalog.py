"""Catálogo de economías criminales y de fuentes.

Cada economía declara por qué importa para LA/FT y por dónde se conecta con los
rieles del sistema financiero chileno. Cada fuente declara su autoridad, su
nivel de riesgo legal y qué NO hace.
"""

ECONOMIES = {
    "EXTORSION_DIGITAL": {
        "label": "Extorsión digital (ransomware)",
        "laft": "Delito precedente con pago en cripto. Las reivindicaciones sobre "
                "entidades chilenas indican exposición operacional de sujetos "
                "obligados y flujos de rescate que buscan salida por exchanges.",
        "rail": "Exchanges y OTC que convierten el rescate; integridad de datos del sujeto obligado.",
    },
    "MERCADO_DATOS_ROBADOS": {
        "label": "Comercio de datos robados",
        "laft": "Las bases filtradas alimentan suplantación de identidad, apertura "
                "de cuentas mula y fraude. Una brecha en un servicio chileno es "
                "insumo para el resto de la cadena.",
        "rail": "Onboarding remoto de bancos, billeteras y emisores de prepago.",
    },
    "FRAUDE_SUPLANTACION": {
        "label": "Fraude por suplantación de marcas financieras",
        "laft": "Phishing contra clientes de instituciones chilenas: el dinero "
                "robado sale por cuentas mula, que son la tipología dominante "
                "(testaferros en el 79% de las condenas, UAF 2025).",
        "rail": "La marca suplantada y las cuentas de destino de las transferencias.",
    },
    "SERVICIOS_FIN_NO_AUTORIZADOS": {
        "label": "Servicios financieros no autorizados",
        "laft": "Entidades que captan dinero simulando estar fiscalizadas. Suelen "
                "recibir los pagos en cuentas de personas naturales.",
        "rail": "Cuentas receptoras en bancos y fintech chilenas.",
    },
    "APUESTAS_ILEGALES": {
        "label": "Apuestas y casinos online no autorizados",
        "laft": "Mercado sin licencia que mueve cientos de miles de millones de "
                "pesos al año y rota dominios para eludir bloqueos.",
        "rail": "Medios de pago declarados en los sitios: PSP, billeteras, transferencias, cripto.",
    },
    "CRIPTO_SANCIONADO": {
        "label": "Criptoactivos sancionados",
        "laft": "Direcciones designadas por OFAC (mercados darknet, mezcladores, "
                "exchanges sancionados, redes de ransomware). Son la lista de "
                "vigilancia para rastrear exposición de exchanges que operan en Chile.",
        "rail": "Exchanges y PSP cripto inscritos o potenciales sujetos obligados.",
    },
    "ECOSISTEMA_DARKWEB": {
        "label": "Ecosistema de mercados y foros",
        "laft": "Estado del ecosistema global: cuántos mercados de tarjetas, "
                "logs de infostealers, foros y canales de actores están activos, "
                "y cuáles se orientan a Chile o Latinoamérica.",
        "rail": "Contexto: no se vincula a entidades.",
    },
}

# legal: 0 = metadatos públicos sin datos personales; 1 = requiere cuidado
# (nombres de organizaciones víctimas); 2 = requiere informe jurídico previo.
SOURCES = {
    "RANSOMWARE_LIVE": {
        "name": "ransomware.live (API v2, víctimas por país)",
        "economy": "EXTORSION_DIGITAL",
        "kind": "api",
        "url": "https://api.ransomware.live/v2/countryvictims/CL",
        "authority": "Agregador independiente que indexa los sitios de filtración de los grupos.",
        "legal": 1,
        "does_not": "No visita los sitios .onion ni descarga lo publicado por los grupos.",
    },
    "RANSOMWATCH": {
        "name": "ransomwatch (archivo histórico)",
        "economy": "EXTORSION_DIGITAL",
        "kind": "feed",
        "url": "https://raw.githubusercontent.com/joshhighet/ransomwatch/main/posts.json",
        "authority": "Proyecto abierto que registró reivindicaciones 2020-2025. Archivado.",
        "legal": 1,
        "does_not": "No visita los sitios .onion ni descarga lo publicado por los grupos.",
    },
    "HIBP_BREACHES": {
        "name": "Have I Been Pwned (catálogo de brechas)",
        "economy": "MERCADO_DATOS_ROBADOS",
        "kind": "api",
        "url": "https://haveibeenpwned.com/api/v3/breaches",
        "authority": "Catálogo verificado de brechas por servicio. Sin consultas por persona.",
        "legal": 0,
        "does_not": "No consulta correos ni personas: sólo el catálogo público de servicios afectados.",
    },
    "PHISHING_DATABASE": {
        "name": "Phishing.Database (dominios activos)",
        "economy": "FRAUDE_SUPLANTACION",
        "kind": "feed",
        "url": "https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt",
        "authority": "Lista comunitaria de dominios de phishing activos, actualización continua.",
        "legal": 0,
        "does_not": "No visita los dominios: sólo compara el nombre contra marcas chilenas.",
    },
    "OPENPHISH": {
        "name": "OpenPhish (feed público)",
        "economy": "FRAUDE_SUPLANTACION",
        "kind": "feed",
        "url": "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt",
        "authority": "Feed público de URLs de phishing detectadas.",
        "legal": 0,
        "does_not": "No visita las URLs.",
    },
    "OFAC_CRYPTO": {
        "name": "OFAC SDN, direcciones cripto (extracción diaria)",
        "economy": "CRIPTO_SANCIONADO",
        "kind": "feed",
        "url": "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/",
        "authority": "Extracción automática y diaria de la lista SDN oficial del Tesoro de EE.UU.",
        "legal": 0,
        "does_not": "No traza transacciones todavía: arma la lista de vigilancia.",
    },
    "DEEPDARKCTI": {
        "name": "deepdarkCTI (catálogo de mercados, foros y canales)",
        "economy": "ECOSISTEMA_DARKWEB",
        "kind": "catalog",
        "url": "https://raw.githubusercontent.com/fastfire/deepdarkCTI/main/",
        "authority": "Catálogo comunitario de fuentes CTI con estado ONLINE/OFFLINE.",
        "legal": 0,
        "does_not": "Guarda nombre, categoría y estado. No guarda ni muestra direcciones .onion ni enlaces de invitación.",
    },
    "CMF_ALERTAS": {
        "name": "CMF, alertas de entidades no autorizadas (curado)",
        "economy": "SERVICIOS_FIN_NO_AUTORIZADOS",
        "kind": "curated",
        "url": "seeds/cmf_alertas.csv",
        "authority": "Comisión para el Mercado Financiero. Cada fila cita su publicación.",
        "legal": 0,
        "does_not": "No raspa el sitio de la CMF todavía: se carga a mano con su fuente.",
    },
    "SUBTEL_BLOQUEOS": {
        "name": "Subtel, sitios de apuestas con orden de bloqueo (curado)",
        "economy": "APUESTAS_ILEGALES",
        "kind": "curated",
        "url": "seeds/subtel_bloqueos.csv",
        "authority": "Orden de bloqueo de la Subtel / resolución judicial. Cada fila cita su fuente.",
        "legal": 0,
        "does_not": "No visita los sitios ni registra cuentas en ellos.",
    },
    "TELEGRAM_PUBLICO": {
        "name": "Canales públicos de Telegram (cuentas mula, datos)",
        "economy": "MERCADO_DATOS_ROBADOS",
        "kind": "pending",
        "url": None,
        "authority": "—",
        "legal": 2,
        "does_not": "No está activo: requiere informe jurídico (Ley 21.459 art. 6, Ley 21.719).",
    },
}
