"""Piezas comunes: descarga, normalización, vínculo con Chile y eventos."""

from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import unicodedata
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "radar-economias/0.1 (+monitor de fuentes abiertas; sin descarga de contenido filtrado)"

# Estados de una fuente en un corte. Son los mismos que distingue ATLAS: una
# fuente no consultada jamás se presenta como una fuente que no encontró nada.
FRESH = "FRESH"                  # respondió y se procesó
ARCHIVE = "ARCHIVE"              # respondió, pero la fuente dejó de actualizarse
DEGRADED = "DEGRADED"            # respondió con error o con un formato inesperado
UNREACHABLE = "UNREACHABLE"      # no se pudo contactar (red, DNS, proxy)
NOT_CONSULTED = "NOT_CONSULTED"  # no se preguntó: falta habilitación, credencial o lista


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _ssl_context() -> ssl.SSLContext:
    cafile = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    return ssl.create_default_context(cafile=cafile) if cafile else ssl.create_default_context()


class FetchError(Exception):
    """Falla de red o HTTP. `reachable` distingue «no respondió» de «respondió mal»."""

    def __init__(self, message: str, reachable: bool):
        super().__init__(message)
        self.reachable = reachable


def fetch(url: str, *, timeout: int = 90, headers: dict[str, str] | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise FetchError(f"HTTP {e.code} en {url}", reachable=True) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise FetchError(f"{type(e).__name__}: {getattr(e, 'reason', e)}", reachable=False) from e


def fetch_json(url: str, **kw: Any) -> Any:
    return json.loads(fetch(url, **kw).decode("utf-8"))


def sha256(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def norm(s: str | None) -> str:
    """Minúsculas, sin acentos ni puntuación: la misma llave que usa ATLAS para nombres."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# Un dominio .cl dentro de un texto libre. El lookahead evita falsos positivos
# como «.club», «.cls» o «cloudeurope.it».
_CL_DOMAIN = re.compile(r"(?<![a-z0-9-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+cl)(?![a-z0-9-])", re.I)
_CHILE_WORD = re.compile(r"\bchile(no|na|nos|nas)?\b", re.I)


def cl_domains(text: str | None) -> list[str]:
    return sorted({m.group(1).lower().removeprefix("www.") for m in _CL_DOMAIN.finditer(text or "")})


def mentions_chile(text: str | None) -> bool:
    return bool(_CHILE_WORD.search(text or ""))


def strip_html(s: str | None) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = s.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"').replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", s).strip()


@dataclass
class Event:
    """Un hecho observado en una fuente. Nunca el contenido de una filtración."""

    economy: str
    source_code: str
    event_type: str
    key: str                       # identidad estable dentro de la fuente
    title: str
    scope: str                     # CL | LATAM | GLOBAL
    observed_at: str
    event_date: str | None = None
    actor: str | None = None       # grupo, mercado o canal que anuncia
    target: dict[str, Any] = field(default_factory=dict)
    chile_link: dict[str, Any] | None = None
    evidence: dict[str, Any] = field(default_factory=dict)
    attributes: dict[str, Any] = field(default_factory=dict)
    first_seen: str | None = None

    @property
    def id(self) -> str:
        return sha256(f"{self.source_code}|{self.key}")[:16]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["id"] = self.id
        d.pop("key")
        return d


@dataclass
class SourceResult:
    code: str
    status: str
    consulted_at: str
    records_in: int = 0
    records_kept: int = 0
    error: str | None = None
    note: str | None = None
    content_sha256: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Collected:
    """Lo que entrega un recolector: su estado, sus eventos y sus indicadores."""

    result: SourceResult
    events: list[Event] = field(default_factory=list)
    indicators: dict[str, Any] = field(default_factory=dict)
    # Material que el corte guarda aparte (p. ej. listas de vigilancia), no como evento.
    sidecar: dict[str, Any] = field(default_factory=dict)


def failed(code: str, err: Exception) -> Collected:
    reachable = getattr(err, "reachable", True)
    return Collected(SourceResult(
        code=code,
        status=DEGRADED if reachable else UNREACHABLE,
        consulted_at=now_iso(),
        error=str(err)[:500],
    ))
