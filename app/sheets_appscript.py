"""Thin wrapper delegating Google Sheets operations to a deployed Apps Script Web
App.

The Apps Script is expected to expose two simple endpoints:
* ``GET  /?action=getInventory`` – returns JSON list of inventory rows. Each
  row must contain ``name``, ``unit_cost``, ``qty`` and ``updated_at`` fields.
* ``POST /`` – receives a JSON body with ``inventory`` key containing the same
  list of rows and writes them back to the spreadsheet. The response is the
  raw Apps Script reply (usually a JSON object indicating success).

Authentication is performed via a static token shared between this backend and
the Apps Script. The token and the script URL are stored in ``.env`` (or the
environment) under ``APPS_SCRIPT_URL`` and ``APPS_SCRIPT_TOKEN``.

Only the minimal functionality required for the migration is implemented –
pulling the inventory into the local DB and pushing the local DB inventory back
to the sheet. All other sheet‑specific logic (formatting, month blocks, etc.)
remains inside the Apps Script and is thus out of scope for this backend.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any, List, Dict

# Resolve configuration from environment or ``.env`` file. The project already
# loads a ``.env`` for other services, but we fall back to ``os.getenv`` for
# safety in case the file is not processed.
APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL")
APPS_SCRIPT_TOKEN = os.getenv("APPS_SCRIPT_TOKEN")

if not APPS_SCRIPT_URL or not APPS_SCRIPT_TOKEN:
    raise RuntimeError(
        "Apps Script configuration missing – set APPS_SCRIPT_URL and APPS_SCRIPT_TOKEN"
    )


def _request(
    method: str, path: str = "", params: dict[str, Any] | None = None, data: Any = None
) -> Any:
    """Make an HTTP request to the Apps Script endpoint.

    ``method``: ``"GET"`` or ``"POST"``.
    ``path``: optional path appended to base URL.
    ``params``: query string parameters – the ``token`` is injected automatically.
    ``data``: JSON‑serialisable body for POST requests.
    Returns the parsed JSON response.
    """
    url = urllib.parse.urljoin(APPS_SCRIPT_URL + "/", path)
    query = params.copy() if params else {}
    query["token"] = APPS_SCRIPT_TOKEN
    url = f"{url}?{urllib.parse.urlencode(query)}"

    req = urllib.request.Request(url, method=method)
    if method == "POST":
        payload = json.dumps(data).encode("utf-8")
        req.add_header("Content-Type", "application/json")
        req.data = payload

    with urllib.request.urlopen(req, timeout=30) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        raw = resp.read().decode(charset)
        return json.loads(raw)


def pull_inventory() -> List[Dict[str, Any]]:
    """Retrieve the current inventory from the Apps Script.

    Expected response format::

        {"inventory": [{"name": "…", "unit_cost": 0, "qty": 0, "updated_at": "…"}, …]}

    Returns the list of inventory rows.
    """
    resp = _request("GET", params={"action": "getInventory"})
    return resp.get("inventory", [])


def push_inventory(conn) -> Dict[str, Any]:
    """Push the local DB inventory to the Apps Script.

    ``conn``: SQLite connection used by the existing codebase. The function reads
    the ``inventory`` table and sends the rows to the Apps Script via POST.
    Returns the Apps Script response (usually a JSON object with ``status``).
    """
    rows = []
    cur = conn.execute(
        "SELECT name, unit_cost, qty, updated_at FROM inventory"
    )
    for name, unit_cost, qty, updated_at in cur.fetchall():
        rows.append(
            {
                "name": name,
                "unit_cost": unit_cost,
                "qty": qty,
                "updated_at": updated_at,
            }
        )
    payload = {"inventory": rows}
    return _request("POST", data=payload)


def get_inventory_status() -> Dict[str, Any]:
    """Optional: check if Apps Script is reachable and return basic info."""
    try:
        # Try a lightweight call: get inventory with limit? We just call getInventory and check length
        data = pull_inventory()
        return {"status": "ok", "inventory_count": len(data)}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def apply_formatting_all() -> Dict[str, Any]:
    """Placeholder for compatibility – formatting is handled by Apps Script itself."""
    # In future we could call Apps Script to trigger formatting, but for now we just return success.
    return {"status": "ok", "message": "Formatting handled by Apps Script"}


def clean_extra_merges() -> Dict[str, Any]:
    """Placeholder for compatibility – merge cleaning handled by Apps Script."""
    return {"status": "ok", "message": "Merge cleaning handled by Apps Script"}