#!/usr/bin/env python
"""Create the "Inventory" tab inside the COGS/Estimate spreadsheet.

Why: the Inventory UI page used to push rows into a *separate* spreadsheet
(the one stored in .inventory_sheet_id). That made the data awkward to reach
and the Estimate page never saw it. Keeping Inventory as a tab of the same
spreadsheet means one file to open, one set of permissions, one sync path.

Idempotent: if the tab already exists it is reused, not duplicated.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.sheets import SHEET_ID, _get_service, resolve_tab_name  # noqa: E402

INVENTORY_TAB_TITLE = "Inventory"


def ensure_inventory_tab() -> str:
    """Return the live title of the Inventory tab, creating it when absent."""
    svc = _get_service()
    existing = resolve_tab_name(svc, SHEET_ID, INVENTORY_TAB_TITLE)
    if existing:
        print(f"Inventory tab already exists: {existing!r}")
        return existing

    body = {"requests": [{"addSheet": {"properties": {"title": INVENTORY_TAB_TITLE}}}]}
    result = svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID, body=body).execute()
    added = result["replies"][0]["addSheet"]["properties"]["title"]
    print(f"Created tab: {added!r}")
    return added


if __name__ == "__main__":
    title = ensure_inventory_tab()
    # Drop the cached title map so the next resolve hits the API fresh.
    import app.sheets as gsheets

    gsheets._TAB_TITLE_CACHE = None
    print(f"Inventory tab ready: {title!r}")