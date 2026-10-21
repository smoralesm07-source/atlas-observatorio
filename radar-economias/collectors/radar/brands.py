"""Marcas financieras y de pago chilenas que se buscan en las bases de phishing.

Es una semilla. La versión integrada debería leer el universo de proveedores de
pago de ATLAS (CMF, SII, PSP) para que la marca llegue con su RUT y no haya dos
catálogos que mantener.

`specific`: el token por sí solo identifica a la marca chilena. Si es False
(marcas regionales o tokens cortos), el dominio debe traer además una señal de
Chile («cl», «chile») para contar.
`official`: dominios legítimos que nunca se cuentan como suplantación.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Brand:
    code: str
    name: str
    kind: str          # banco | billetera | pagos | cripto | retail_financiero
    tokens: tuple[str, ...]
    specific: bool
    official: tuple[str, ...] = ()


BRANDS: tuple[Brand, ...] = (
    Brand("BANCOESTADO", "BancoEstado / CuentaRUT", "banco", ("bancoestado", "cuentarut", "bancestado"), True, ("bancoestado.cl",)),
    Brand("BANCO_CHILE", "Banco de Chile", "banco", ("bancochile", "bancodechile", "bancoedwards"), True, ("bancochile.cl", "bancoedwards.cl")),
    Brand("BCI", "Bci", "banco", ("bci",), False, ("bci.cl",)),
    Brand("SANTANDER_CL", "Santander Chile", "banco", ("santander",), False, ("santander.cl",)),
    Brand("ITAU_CL", "Itaú Chile", "banco", ("itau",), False, ("itau.cl",)),
    Brand("SCOTIABANK_CL", "Scotiabank Chile", "banco", ("scotiabank",), False, ("scotiabankchile.cl", "scotiabank.cl")),
    Brand("FALABELLA", "Banco / CMR Falabella", "retail_financiero", ("falabella", "cmrfalabella"), False, ("falabella.com", "bancofalabella.cl")),
    Brand("RIPLEY", "Banco Ripley", "retail_financiero", ("ripley", "bancoripley"), False, ("bancoripley.cl", "ripley.cl")),
    Brand("TENPO", "Tenpo", "billetera", ("tenpo",), True, ("tenpo.cl",)),
    Brand("MACH", "MACH", "billetera", ("machbank", "somosmach"), True, ("somosmach.com",)),
    Brand("MERCADOPAGO_CL", "Mercado Pago Chile", "billetera", ("mercadopago",), False, ("mercadopago.cl",)),
    Brand("TRANSBANK", "Transbank / Webpay", "pagos", ("transbank", "webpay"), False, ("transbank.cl", "webpay.cl")),
    Brand("KHIPU", "Khipu", "pagos", ("khipu",), False, ("khipu.com",)),
    Brand("BUDA", "Buda.com", "cripto", ("buda",), False, ("buda.com",)),
    Brand("ORIONX", "Orionx", "cripto", ("orionx",), True, ("orionx.com",)),
    Brand("CRYPTOMKT", "CryptoMarket", "cripto", ("cryptomkt",), True, ("cryptomkt.com",)),
    Brand("CLAVEUNICA", "ClaveÚnica (Estado)", "estado", ("claveunica",), True, ("claveunica.gob.cl",)),
)

_SPLIT = re.compile(r"[.\-_]+")


def _chile_cue(host: str, labels: list[str]) -> bool:
    return host.endswith(".cl") or "cl" in labels or "chile" in host


def _is_official(host: str, brand: Brand) -> bool:
    return any(host == d or host.endswith("." + d) for d in brand.official)


def match_brand(host: str) -> Brand | None:
    """Devuelve la marca chilena que un nombre de dominio suplanta, o None.

    Tokens de 6 o más letras se buscan como subcadena («bancoestadochile»);
    los cortos («bci», «buda») sólo como etiqueta completa, para no contar
    «budapest» o «abci-news».
    """
    host = host.strip().lower().removeprefix("www.")
    if not host or "/" in host:
        return None
    labels = [x for x in _SPLIT.split(host) if x]
    for brand in BRANDS:
        if _is_official(host, brand):
            continue
        hit = any((t in host) if len(t) >= 6 else (t in labels) for t in brand.tokens)
        if not hit:
            continue
        if brand.specific or _chile_cue(host, labels):
            return brand
    return None
