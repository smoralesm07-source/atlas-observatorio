"""Comercio de datos robados: brechas catalogadas de servicios chilenos.

Se usa sólo el catálogo público de brechas (qué servicio, cuándo, cuántas
cuentas, qué tipos de dato). Nunca se consulta una persona ni un correo.
"""

from __future__ import annotations

import json
from typing import Any

from ..catalog import SOURCES
from ..core import FRESH, Collected, Event, SourceResult, failed, fetch, mentions_chile, now_iso, sha256, strip_html

ECONOMY = "MERCADO_DATOS_ROBADOS"


def chile_link(b: dict[str, Any]) -> dict[str, Any] | None:
    domain = (b.get("Domain") or "").lower()
    if domain.endswith(".cl"):
        return {"reason": "dominio .cl del servicio", "confidence": "alta"}
    if mentions_chile(f"{b.get('Title', '')} {strip_html(b.get('Description'))}"):
        return {"reason": "la descripción menciona Chile", "confidence": "media"}
    return None


def parse(breaches: list[dict[str, Any]], observed_at: str) -> list[Event]:
    out: list[Event] = []
    for b in breaches:
        link = chile_link(b)
        if not link or b.get("IsSpamList"):
            continue
        name = b.get("Name") or b.get("Title")
        out.append(Event(
            economy=ECONOMY,
            source_code="HIBP_BREACHES",
            event_type="BRECHA_CATALOGADA",
            key=str(name),
            title=b.get("Title") or str(name),
            scope="CL",
            observed_at=observed_at,
            event_date=b.get("BreachDate"),
            target={"name": b.get("Title"), "domain": b.get("Domain") or None, "country": "CL"},
            chile_link=link,
            evidence={"source_url": f"https://haveibeenpwned.com/PwnedWebsites#{name}"},
            attributes={
                "accounts": b.get("PwnCount"),
                "data_classes": b.get("DataClasses") or [],
                "verified": b.get("IsVerified"),
                "added": (b.get("AddedDate") or "")[:10] or None,
            },
        ))
    return out


def collect() -> Collected:
    url = SOURCES["HIBP_BREACHES"]["url"]
    try:
        raw = fetch(url, headers={"Accept": "application/json"})
        breaches = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        return failed("HIBP_BREACHES", e)
    at = now_iso()
    events = parse(breaches, at)
    return Collected(SourceResult("HIBP_BREACHES", FRESH, at, len(breaches), len(events), content_sha256=sha256(raw)),
                     events, {"breaches_cl": len(events),
                              "accounts_cl": sum(int(e.attributes.get("accounts") or 0) for e in events)})
