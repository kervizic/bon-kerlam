"""KERLAM "bon" — read-only MCP server (beta).

This server exposes a small set of READ-ONLY tools over the KERLAM "bon" app
data. It never talks to Postgres directly: every tool calls the bon-worker
HTTP API (a FastAPI service) which owns the database connection, using a
hashed AI token with "read" scope.

No write tools are implemented in this beta. Mutating the "bon" data (LV,
tours, referentiels, ...) must go through the bon-worker's authenticated
write endpoints directly, outside of this MCP server.

Configuration (environment variables):
    BON_WORKER_URL   Base URL of the bon-worker API.
                      Default: http://127.0.0.1:8099
    BON_AI_TOKEN      Hashed AI token sent as the "X-AI-Token" header.
                      Required for every call; a "read" scope token is enough.

Run directly:
    python mcp/server.py

Transport: stdio (default for `mcp.run()`), suitable for registration in
Claude Desktop or any MCP-compatible client — see mcp/README.md.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

DEFAULT_WORKER_URL = "http://127.0.0.1:8099"
REQUEST_TIMEOUT_SECONDS = 10.0

mcp = FastMCP("bon-kerlam-readonly")


def _worker_base_url() -> str:
    """Return the configured bon-worker base URL, without a trailing slash."""
    url = os.environ.get("BON_WORKER_URL", DEFAULT_WORKER_URL)
    return url.rstrip("/")


def _ai_token() -> str:
    """Return the configured AI token, raising a clear error if it is missing.

    Raises:
        RuntimeError: if BON_AI_TOKEN is not set or is empty. This is raised
            (not silently ignored) so the error surfaces clearly as a tool
            error in the MCP client instead of failing worker-side with a
            generic 401.
    """
    token = os.environ.get("BON_AI_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "BON_AI_TOKEN is not set. Configure the environment variable "
            "BON_AI_TOKEN with a hashed AI token (scope 'read' or 'write') "
            "issued by the bon-worker before using this MCP server."
        )
    return token


def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    """Perform a GET request against the bon-worker API and return parsed JSON.

    Args:
        path: Path appended to the worker base URL, e.g. "/worker/lv".
        params: Optional query string parameters. Empty-string values are
            dropped so that unset optional filters are not sent at all.

    Returns:
        The JSON-decoded response body (list or dict, depending on endpoint).

    Raises:
        RuntimeError: on missing token, unreachable worker, timeout, or a
            non-2xx HTTP response. Error messages are written to be read
            directly by whoever is driving the MCP client.
    """
    token = _ai_token()
    url = f"{_worker_base_url()}{path}"
    clean_params = {k: v for k, v in (params or {}).items() if v not in (None, "")}

    try:
        response = httpx.get(
            url,
            params=clean_params,
            headers={"X-AI-Token": token},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.TimeoutException as exc:
        raise RuntimeError(
            f"Timed out after {REQUEST_TIMEOUT_SECONDS}s calling bon-worker at "
            f"{url}. Is bon-worker running and reachable at BON_WORKER_URL "
            f"({_worker_base_url()})?"
        ) from exc
    except httpx.ConnectError as exc:
        raise RuntimeError(
            f"Could not connect to bon-worker at {url}. Check that bon-worker "
            f"is running and that BON_WORKER_URL ({_worker_base_url()}) is "
            f"correct."
        ) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"HTTP error calling bon-worker at {url}: {exc}") from exc

    if response.status_code == 401:
        raise RuntimeError(
            "bon-worker rejected the request (401 Unauthorized). Check that "
            "BON_AI_TOKEN is valid and not expired/revoked."
        )
    if response.status_code == 403:
        raise RuntimeError(
            "bon-worker rejected the request (403 Forbidden). The AI token "
            "does not have the required scope for this endpoint."
        )
    if response.status_code == 404:
        raise RuntimeError(f"bon-worker returned 404 Not Found for {url}.")
    if response.is_error:
        raise RuntimeError(
            f"bon-worker returned HTTP {response.status_code} for {url}: "
            f"{response.text[:500]}"
        )

    try:
        return response.json()
    except ValueError as exc:
        raise RuntimeError(
            f"bon-worker returned a non-JSON response for {url}."
        ) from exc


@mcp.tool()
def lv_rechercher(query: str = "", date: str = "", statut: str = "") -> Any:
    """Search LV (lettres de voiture / delivery notes) summaries.

    Calls GET /worker/lv on bon-worker with optional filters. All filters are
    optional; an empty string means "no filter on this field".

    Args:
        query: Free-text search (client, projet, numero LV, ...). Empty = no
            text filter.
        date: Filter on a specific date, format "YYYY-MM-DD". Empty = no date
            filter.
        statut: Filter on LV status (e.g. "brouillon", "valide", "facture").
            Empty = no status filter.

    Returns:
        A list of LV summary objects as returned by bon-worker.
    """
    return _get(
        "/worker/lv",
        params={"query": query, "date": date, "statut": statut},
    )


@mcp.tool()
def lv_lire(lv_id: int) -> Any:
    """Read one LV (lettre de voiture) in full detail, including tours and lines.

    Calls GET /worker/lv/{id} on bon-worker.

    Args:
        lv_id: Numeric identifier of the LV to fetch.

    Returns:
        The full LV object (header, tours, lines) as returned by bon-worker.
    """
    return _get(f"/worker/lv/{lv_id}")


@mcp.tool()
def alertes() -> Any:
    """List upcoming expirations needing attention in the next 60 days.

    Calls GET /worker/alertes on bon-worker. Covers CT (controle technique)
    and chrono (limiteur) expirations for camions, and FCO / carte
    conducteur expirations for chauffeurs.

    Returns:
        A list of alert objects (entity type, entity id/label, expiration
        kind, expiration date) as returned by bon-worker.
    """
    return _get("/worker/alertes")


@mcp.tool()
def referentiel_lister(kind: str) -> Any:
    """List reference data of a given kind (camions, chauffeurs, clients, ...).

    Calls GET /worker/referentiel/{kind} on bon-worker.

    Args:
        kind: One of "camions", "chauffeurs", "clients", "projets", "sites",
            "articles". Any other value is rejected locally before calling
            the worker, to give a clear error instead of a generic 404.

    Returns:
        A list of reference records of the requested kind, as returned by
        bon-worker.
    """
    valid_kinds = {"camions", "chauffeurs", "clients", "projets", "sites", "articles"}
    if kind not in valid_kinds:
        raise RuntimeError(
            f"Invalid kind '{kind}'. Must be one of: {', '.join(sorted(valid_kinds))}."
        )
    return _get(f"/worker/referentiel/{kind}")


if __name__ == "__main__":
    mcp.run()
