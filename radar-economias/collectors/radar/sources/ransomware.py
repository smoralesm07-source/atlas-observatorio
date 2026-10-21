"""Extorsión digital: reivindicaciones de ransomware sobre entidades chilenas.

Una reivindicación es lo que un grupo publica en su sitio de filtración. No es
un incidente confirmado: los grupos exageran, reciclan víctimas y a veces
mienten. El radar la registra como tal.
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from ..catalog import SOURCES
from ..core import (ARCHIVE, FRESH, Collected, Event, SourceResult, cl_domains, failed, fetch,
                    mentions_chile, norm, now_iso, sha256, strip_html)

ECONOMY = "EXTORSION_DIGITAL"


def _first(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return None


def _date(v: Any) -> str | None:
    s = str(v or "").strip()
    return s[:10] if len(s) >= 10 and s[4] == "-" else None


def chile_link_for_post(title: str, description: str = "") -> dict[str, Any] | None:
    """Vínculo con Chile de una publicación sin campo de país (archivo ransomwatch)."""
    text = f"{title} {description}"
    doms = cl_domains(text)
    if doms:
        return {"reason": "dominio .cl en la publicación", "domains": doms, "confidence": "alta"}
    if mentions_chile(text):
        return {"reason": "menciona Chile en la publicación", "confidence": "media"}
    return None


def parse_ransomware_live(items: list[dict[str, Any]], observed_at: str, url: str) -> list[Event]:
    """Formato v2 de ransomware.live. Tolera nombres de campo alternativos,
    porque la API no publica un contrato versionado."""
    out: list[Event] = []
    for it in items:
        victim = strip_html(str(_first(it, "victim", "post_title", "name") or ""))
        group = str(_first(it, "group", "group_name") or "").strip() or None
        if not victim:
            continue
        country = str(_first(it, "country") or "").upper() or None
        domain = str(_first(it, "domain", "website") or "").strip().lower().removeprefix("www.") or None
        discovered = _date(_first(it, "discovered", "published", "date"))
        attacked = _date(_first(it, "attackdate", "attack_date"))
        out.append(Event(
            economy=ECONOMY,
            source_code="RANSOMWARE_LIVE",
            event_type="REIVINDICACION_RANSOMWARE",
            key=f"{norm(group)}|{norm(victim)}|{discovered}",
            title=victim,
            scope="CL" if country in (None, "CL") else "GLOBAL",
            observed_at=observed_at,
            event_date=attacked or discovered,
            actor=group,
            target={"name": victim, "domain": domain, "country": country,
                    "sector": _first(it, "activity", "sector")},
            chile_link={"reason": "país declarado por el agregador", "confidence": "alta"} if country == "CL" else None,
            evidence={"source_url": url},
            attributes={"discovered": discovered, "attack_date": attacked},
        ))
    return out


def parse_ransomwatch(posts: list[dict[str, Any]], observed_at: str, url: str) -> list[Event]:
    out: dict[str, Event] = {}
    for p in sorted(posts, key=lambda x: str(x.get("discovered", ""))):
        raw_title = strip_html(p.get("post_title"))
        link = chile_link_for_post(raw_title, strip_html(p.get("description")))
        if not link:
            continue
        # Algunos grupos agregan monto y volumen al título («dominio.cl\$25M\460GB»).
        title = raw_title.split("\\")[0].strip() or raw_title
        group = (p.get("group_name") or "").strip() or None
        discovered = _date(p.get("discovered"))
        doms = link.get("domains") or []
        # Un grupo puede republicar a la misma víctima: la llave es el dominio y
        # la fecha del evento es la primera publicación.
        key = f"{norm(group)}|{doms[0] if doms else norm(title)}"
        if key in out:
            out[key].attributes["republications"] = out[key].attributes.get("republications", 0) + 1
            continue
        out[key] = Event(
            economy=ECONOMY,
            source_code="RANSOMWATCH",
            event_type="REIVINDICACION_RANSOMWARE",
            key=key,
            title=title,
            scope="CL",
            observed_at=observed_at,
            event_date=discovered,
            actor=group,
            target={"name": title, "domain": doms[0] if doms else None, "country": "CL"},
            chile_link=link,
            evidence={"source_url": url},
            attributes={"discovered": discovered},
        )
    return list(out.values())


def indicators(events: list[Event]) -> dict[str, Any]:
    by_year = Counter((e.event_date or "s/f")[:4] for e in events)
    by_group = Counter(e.actor or "desconocido" for e in events)
    return {
        "victims_cl": len(events),
        "by_year": dict(sorted(by_year.items())),
        "top_groups": by_group.most_common(10),
    }


def collect_live() -> Collected:
    meta = SOURCES["RANSOMWARE_LIVE"]
    try:
        raw = fetch(meta["url"], headers={"Accept": "application/json"})
        data = json.loads(raw)
        items = data if isinstance(data, list) else data.get("victims") or data.get("data") or []
    except Exception as e:  # noqa: BLE001 — cualquier falla queda declarada en el corte
        return failed("RANSOMWARE_LIVE", e)
    at = now_iso()
    events = [e for e in parse_ransomware_live(items, at, meta["url"]) if e.scope == "CL"]
    return Collected(SourceResult("RANSOMWARE_LIVE", FRESH, at, len(items), len(events),
                                  content_sha256=sha256(raw)), events)


def collect_watch() -> Collected:
    meta = SOURCES["RANSOMWATCH"]
    try:
        raw = fetch(meta["url"])
        posts = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        return failed("RANSOMWATCH", e)
    at = now_iso()
    events = parse_ransomwatch(posts, at, meta["url"])
    last = max((str(p.get("discovered", "")) for p in posts), default="")[:10]
    return Collected(SourceResult("RANSOMWATCH", ARCHIVE, at, len(posts), len(events),
                                  note=f"Archivo sin actualizaciones desde {last}. Sirve como línea base histórica.",
                                  content_sha256=sha256(raw)), events)
