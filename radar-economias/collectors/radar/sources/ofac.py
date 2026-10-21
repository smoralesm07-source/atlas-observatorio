"""Criptoactivos sancionados: direcciones de la lista SDN de OFAC.

Arma la lista de vigilancia que usará el módulo de exposición cripto. En este
corte no se rastrean transacciones: se cuentan direcciones por red y se marcan
como evento las designaciones nuevas respecto del corte anterior.
"""

from __future__ import annotations

from ..catalog import SOURCES
from ..core import FRESH, Collected, Event, FetchError, SourceResult, failed, fetch, now_iso, sha256

ECONOMY = "CRIPTO_SANCIONADO"

# Redes de mayor uso en flujos latinoamericanos primero: USDT sobre TRON es la
# vía habitual de las remesas informales y del cash-out.
CHAINS = ("TRX", "USDT", "ETH", "XBT", "USDC", "BSC", "LTC", "XMR", "SOL", "ARB", "BCH", "ETC", "ZEC", "DASH", "XRP", "BSV", "BTG", "XVG")


def parse_list(text: str) -> list[str]:
    return sorted({x.strip() for x in text.splitlines() if x.strip() and not x.startswith("#")})


def diff_events(current: dict[str, list[str]], previous: dict[str, list[str]] | None, observed_at: str, base: str) -> list[Event]:
    """Sólo hay «nuevas» si existe un corte anterior: el primero es línea base."""
    if not previous:
        return []
    out: list[Event] = []
    for chain, addrs in current.items():
        before = set(previous.get(chain) or [])
        if chain not in previous:
            continue
        for a in addrs:
            if a in before:
                continue
            out.append(Event(
                economy=ECONOMY,
                source_code="OFAC_CRYPTO",
                event_type="DIRECCION_DESIGNADA",
                key=f"{chain}|{a}",
                title=f"Nueva dirección {chain} en la lista SDN",
                scope="GLOBAL",
                observed_at=observed_at,
                event_date=observed_at[:10],
                target={"chain": chain, "address": a},
                evidence={"source_url": f"{base}sanctioned_addresses_{chain}.txt"},
            ))
    return out


def collect(previous: dict[str, list[str]] | None) -> Collected:
    base = SOURCES["OFAC_CRYPTO"]["url"]
    lists: dict[str, list[str]] = {}
    missing: list[str] = []
    digest = []
    for chain in CHAINS:
        try:
            raw = fetch(f"{base}sanctioned_addresses_{chain}.txt")
        except FetchError as e:
            if not e.reachable:
                return failed("OFAC_CRYPTO", e)
            missing.append(chain)
            continue
        digest.append(sha256(raw))
        lists[chain] = parse_list(raw.decode("utf-8", "replace"))
    if not lists:
        return failed("OFAC_CRYPTO", FetchError("ninguna lista disponible", reachable=True))
    at = now_iso()
    events = diff_events(lists, previous, at, base)
    total = sum(len(v) for v in lists.values())
    note = "Primer corte: línea base, sin designaciones nuevas que marcar." if not previous else None
    if missing:
        note = (note + " " if note else "") + f"Redes sin lista publicada: {', '.join(missing)}."
    return Collected(
        SourceResult("OFAC_CRYPTO", FRESH, at, total, len(events), note=note, content_sha256=sha256("".join(digest))),
        events,
        {"addresses_total": total, "by_chain": {k: len(v) for k, v in sorted(lists.items(), key=lambda kv: -len(kv[1]))}},
        {"ofac_crypto": lists},
    )
