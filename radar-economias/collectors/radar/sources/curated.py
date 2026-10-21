"""Fuentes curadas a mano: alertas de la CMF y órdenes de bloqueo de la Subtel.

Cada fila cita la publicación de donde sale. Mientras un archivo no tenga
filas, la fuente queda NO CONSULTADA: un archivo vacío no significa que no
haya entidades alertadas.
"""

from __future__ import annotations

import csv
from pathlib import Path

from ..catalog import SOURCES
from ..core import FRESH, NOT_CONSULTED, Collected, Event, SourceResult, norm, now_iso, sha256

SEEDS = Path(__file__).resolve().parents[3] / "seeds"


def _rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if (r.get("name") or "").strip()]


def collect_cmf() -> Collected:
    return _collect("CMF_ALERTAS", "ENTIDAD_ALERTADA")


def collect_subtel() -> Collected:
    return _collect("SUBTEL_BLOQUEOS", "SITIO_BLOQUEADO")


def _collect(code: str, event_type: str) -> Collected:
    meta = SOURCES[code]
    path = SEEDS / Path(meta["url"]).name
    rows = _rows(path)
    at = now_iso()
    if not rows:
        return Collected(SourceResult(code, NOT_CONSULTED, at,
                                      note=f"{path.name} no tiene filas cargadas. Ver seeds/README.md."))
    events = [Event(
        economy=meta["economy"],
        source_code=code,
        event_type=event_type,
        key=norm(r["name"]) + "|" + (r.get("domain") or ""),
        title=r["name"].strip(),
        scope="CL",
        observed_at=at,
        event_date=(r.get("published") or "").strip() or None,
        target={"name": r["name"].strip(), "domain": (r.get("domain") or "").strip() or None, "country": "CL"},
        chile_link={"reason": "publicado por un organismo chileno", "confidence": "alta"},
        evidence={"source_url": (r.get("source_url") or "").strip() or None},
        attributes={"note": (r.get("note") or "").strip() or None},
    ) for r in rows]
    return Collected(SourceResult(code, FRESH, at, len(rows), len(events),
                                  content_sha256=sha256(path.read_bytes())), events)
