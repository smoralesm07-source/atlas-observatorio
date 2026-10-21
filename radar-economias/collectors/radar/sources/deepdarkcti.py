"""Ecosistema: mercados, foros y canales catalogados por deepdarkCTI.

Se guarda nombre, categoría y estado. Las direcciones .onion y los enlaces de
invitación a Telegram se descartan al parsear: el radar no se convierte en un
directorio de acceso a mercados criminales.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from ..catalog import SOURCES
from ..core import FRESH, Collected, Event, FetchError, SourceResult, failed, fetch, norm, now_iso, sha256

ECONOMY = "ECOSISTEMA_DARKWEB"

CATEGORIES = {
    "markets.md": "Mercados",
    "forum.md": "Foros",
    "ransomware_gang.md": "Sitios de grupos de ransomware",
    "telegram_threat_actors.md": "Canales de actores en Telegram",
    "telegram_infostealer.md": "Canales de logs de infostealers",
    "maas.md": "Malware como servicio",
    "counterfeit_goods.md": "Bienes falsificados",
}

ACTIVE = {"ONLINE", "VALID"}
INACTIVE = {"OFFLINE", "EXPIRED"}

_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_URL = re.compile(r"(https?://\S+|\S+\.onion\S*|\S+\.i2p\S*|t\.me/\S+)", re.I)
_LATAM = re.compile(r"chile|latam|latino|latin america|hispan|espa[nñ]ol|spanish|argentin|per[uú]\b|mexic|colombia|brasil|brazil|venezuel|ecuador|bolivia|uruguay|paraguay", re.I)
_CHILE = re.compile(r"chile", re.I)


def _clean(cell: str) -> str:
    cell = _LINK.sub(r"\1", cell)
    return _URL.sub("", cell).strip()


def market_kind(name: str) -> str:
    n = name.lower()
    if re.search(r"cvv|card|dump|bin\b|fullz|cc\b", n):
        return "tarjetas"
    if re.search(r"log|stealer|bot|cloud", n):
        return "logs de infostealers"
    if re.search(r"leak|breach|data", n):
        return "bases filtradas"
    return "general"


def parse_table(md: str) -> list[dict[str, str]]:
    """Filas de la tabla markdown, sin URLs.

    El catálogo se edita a mano y trae filas sin la barra inicial, así que se
    acepta cualquier línea con separadores en vez de cortar en la primera
    irregularidad.
    """
    rows: list[dict[str, str]] = []
    header: list[str] | None = None
    for line in md.splitlines():
        line = line.strip()
        if line.count("|") < 2:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if header is None:
            header = [norm(c) for c in cells]
            continue
        if all(set(c) <= set("-: ") for c in cells) or [norm(c) for c in cells] == header:
            continue
        raw = dict(zip(header, cells))
        status = next((raw[h] for h in header if h == "status"), "").upper().strip()
        name_col = next((h for h in header if "name" in h), header[0])
        desc = " ".join(_clean(raw.get(h, "")) for h in header if h in ("description", "type of attacks")).strip()
        # Hay filas que sólo traen la dirección: cuentan para el estado del
        # ecosistema aunque no tengan un nombre que mostrar.
        name = _clean(raw.get(name_col, "")) or desc or "(sin nombre)"
        rows.append({"name": name, "status": status, "description": desc})
    return rows


def summarize(category: str, rows: list[dict[str, str]]) -> dict[str, Any]:
    active = sum(r["status"] in ACTIVE for r in rows)
    inactive = sum(r["status"] in INACTIVE for r in rows)
    out: dict[str, Any] = {"category": category, "total": len(rows), "active": active,
                           "inactive": inactive, "unknown": len(rows) - active - inactive}
    if category == "Mercados":
        out["active_by_kind"] = dict(Counter(market_kind(r["name"]) for r in rows if r["status"] in ACTIVE))
    return out


def regional_events(category: str, rows: list[dict[str, str]], observed_at: str, url: str) -> list[Event]:
    out: list[Event] = []
    for r in rows:
        text = f"{r['name']} {r['description']}"
        if r["name"] == "(sin nombre)" or not _LATAM.search(text):
            continue
        cl = bool(_CHILE.search(text))
        out.append(Event(
            economy=ECONOMY,
            source_code="DEEPDARKCTI",
            event_type="ACTOR_ORIENTADO_REGION",
            key=f"{category}|{norm(r['name'])}",
            title=r["name"],
            scope="CL" if cl else "LATAM",
            observed_at=observed_at,
            actor=r["name"],
            target={"category": category},
            chile_link={"reason": "el nombre del actor alude a Chile", "confidence": "media"} if cl else None,
            evidence={"source_url": url},
            attributes={"status": r["status"] or "SIN ESTADO", "description": r["description"] or None},
        ))
    return out


def collect() -> Collected:
    base = SOURCES["DEEPDARKCTI"]["url"]
    at = now_iso()
    summaries: list[dict[str, Any]] = []
    events: list[Event] = []
    digest: list[str] = []
    total = 0
    for fname, category in CATEGORIES.items():
        try:
            raw = fetch(base + fname)
        except FetchError as e:
            if not e.reachable:
                return failed("DEEPDARKCTI", e)
            summaries.append({"category": category, "error": str(e)})
            continue
        digest.append(sha256(raw))
        rows = parse_table(raw.decode("utf-8", "replace"))
        total += len(rows)
        summaries.append(summarize(category, rows))
        events.extend(regional_events(category, rows, at, base + fname))
    return Collected(
        SourceResult("DEEPDARKCTI", FRESH, at, total, len(events),
                     note="Estado ONLINE/OFFLINE según el catálogo comunitario; no se verifica de forma independiente.",
                     content_sha256=sha256("".join(digest))),
        events,
        {"categories": summaries},
    )
