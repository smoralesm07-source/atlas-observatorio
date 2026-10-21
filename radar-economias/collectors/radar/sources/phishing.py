"""Fraude por suplantación: dominios de phishing que imitan marcas chilenas.

Se compara sólo el nombre del dominio contra el catálogo de marcas. Ningún
dominio se visita.
"""

from __future__ import annotations

from collections import Counter
from urllib.parse import urlsplit

from ..brands import match_brand
from ..catalog import SOURCES
from ..core import FRESH, Collected, Event, SourceResult, failed, fetch, now_iso, sha256

ECONOMY = "FRAUDE_SUPLANTACION"


def host_of(line: str) -> str:
    line = line.strip()
    if not line or line.startswith("#"):
        return ""
    if "://" in line:
        return (urlsplit(line).hostname or "").lower()
    return line.split("/")[0].lower()


def parse_lines(lines: list[str], code: str, observed_at: str, url: str) -> list[Event]:
    seen: set[str] = set()
    out: list[Event] = []
    for line in lines:
        host = host_of(line).removeprefix("www.")
        if not host or host in seen:
            continue
        brand = match_brand(host)
        if not brand:
            continue
        seen.add(host)
        out.append(Event(
            economy=ECONOMY,
            source_code=code,
            event_type="DOMINIO_SUPLANTACION",
            key=host,
            title=host,
            scope="CL",
            observed_at=observed_at,
            actor=None,
            target={"name": brand.name, "brand_code": brand.code, "brand_kind": brand.kind},
            chile_link={"reason": f"suplanta la marca {brand.name}", "confidence": "alta" if brand.specific else "media"},
            evidence={"source_url": url, "indicator": host.replace(".", "[.]")},
        ))
    return out


def indicators(events: list[Event]) -> dict:
    by_brand = Counter(e.target["name"] for e in events)
    by_kind = Counter(e.target["brand_kind"] for e in events)
    return {"domains": len(events), "by_brand": by_brand.most_common(), "by_kind": dict(by_kind)}


def _collect(code: str) -> Collected:
    url = SOURCES[code]["url"]
    try:
        raw = fetch(url, timeout=180)
    except Exception as e:  # noqa: BLE001
        return failed(code, e)
    at = now_iso()
    lines = raw.decode("utf-8", "replace").splitlines()
    events = parse_lines(lines, code, at, url)
    return Collected(SourceResult(code, FRESH, at, len(lines), len(events), content_sha256=sha256(raw)), events)


def collect_phishing_database() -> Collected:
    return _collect("PHISHING_DATABASE")


def collect_openphish() -> Collected:
    return _collect("OPENPHISH")
