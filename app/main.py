# FastAPI app: CRUD API for inventory + HTMX UI
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app import database as dbmod
from app.cogs import compute_cogs
from app.database import get_db
from app import sheets as gsheets


class ItemCreate(BaseModel):
    name: str
    qty: float = 0
    unit_cost: float = 0
    product_tab: Optional[str] = None


class ItemUpdate(BaseModel):
    qty: Optional[float] = None
    unit_cost: Optional[float] = None


class UsageRow(BaseModel):
    nama_bahan: str
    harga_kg: float
    pemakaian_gram: float = 0


class CogsRequest(BaseModel):
    rows: list[UsageRow]


app = FastAPI(title="Cake Inventory")

BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
def root(request: Request):
    return templates.TemplateResponse(request, "index.html", {"active": "home"})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/inventory")
def list_inventory(con: sqlite3.Connection = Depends(get_db)):
    return dbmod.get_all_items(con)


@app.get("/api/inventory/{item_id}")
def get_inventory(item_id: int, con: sqlite3.Connection = Depends(get_db)):
    item = dbmod.get_item(con, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@app.post("/api/inventory")
def create_inventory(payload: ItemCreate, con: sqlite3.Connection = Depends(get_db)):
    return dbmod.create_item(con, payload.name, payload.qty, payload.unit_cost, payload.product_tab)


@app.put("/api/inventory/{item_id}")
def update_inventory(item_id: int, payload: ItemUpdate, con: sqlite3.Connection = Depends(get_db)):
    item = dbmod.update_item(con, item_id, qty=payload.qty, unit_cost=payload.unit_cost)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@app.delete("/api/inventory/{item_id}")
def delete_inventory(item_id: int, con: sqlite3.Connection = Depends(get_db)):
    ok = dbmod.delete_item(con, item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"status": "deleted", "id": item_id}


@app.post("/api/cogs")
def calc_cogs(payload: CogsRequest):
    rows = [r.model_dump() for r in payload.rows]
    return compute_cogs(rows)


class EstimateSubmit(BaseModel):
    month_num: int
    diameter: Optional[str] = None
    product_tab: str = ""
    item_id: int
    qty: float


def _record_estimate(con: sqlite3.Connection, payload: EstimateSubmit):
    """Shared core logic for recording an estimate row.

    Returns (tab, error_or_None, context_dict).
    """
    tab = dbmod.resolve_product_tab(payload.product_tab) if payload.product_tab else \
          (dbmod.resolve_product_tab(payload.diameter) if payload.diameter else "")
    if not tab:
        return "", "product_tab (or diameter) is required", {}
    item = dbmod.get_item(con, payload.item_id)
    if not item:
        return "", f"Item {payload.item_id} not found", {}
    if not dbmod.decrement_stock(con, payload.item_id, payload.qty):
        return "", f"Insufficient stock for '{item['name']}'", {}
    existing = con.execute(
        "SELECT id, qty_used FROM estimate_entry WHERE month_num=? AND product_tab=? AND item_id=?",
        (payload.month_num, tab, payload.item_id),
    ).fetchone()
    if existing:
        new_qty = existing["qty_used"] + payload.qty
        con.execute("UPDATE estimate_entry SET qty_used=? WHERE id=?", (new_qty, existing["id"]))
        con.commit()
    else:
        dbmod.create_estimate_entry(
            con,
            month_num=payload.month_num,
            product_tab=tab,
            item_id=payload.item_id,
            item_name=item["name"],
            qty_used=payload.qty,
        )
    ctx = {
        "item_name": item["name"],
        "tab": tab,
        "month_num": payload.month_num,
        "qty": payload.qty,
    }
    return tab, None, ctx


def _sync_estimate_or_note(con: sqlite3.Connection, month_num: int, tab: str) -> str:
    """Sync the estimate sheet, returning URL or an error note."""
    try:
        from app.sheets_estimate import sync_estimate_sheet
        return sync_estimate_sheet(con, month_num, tab)
    except Exception as exc:
        return f"(sheet sync skipped: {exc})"


@app.post("/api/estimate")
def submit_estimate(payload: EstimateSubmit, con: sqlite3.Connection = Depends(get_db)):
    """Record one estimate row: aggregate dup qty, decrement stock, sync sheet.

    Diameter dropdown value maps to a product tab via dbmod.resolve_product_tab.
    If the same item+tab+month already exists, qty_used is summed instead of
    creating a duplicate row.
    """
    # product_tab comes straight from the 9-tab dropdown (or legacy diameter)
    tab = dbmod.resolve_product_tab(payload.product_tab) if payload.product_tab else \
          (dbmod.resolve_product_tab(payload.diameter) if payload.diameter else "")
    if not tab:
        raise HTTPException(status_code=400, detail="product_tab (or diameter) is required")
    item = dbmod.get_item(con, payload.item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Item {payload.item_id} not found")
    if not dbmod.decrement_stock(con, payload.item_id, payload.qty):
        raise HTTPException(status_code=400, detail=f"Insufficient stock for '{item['name']}'")
    # Aggregate: sum qty_used into existing row for same month+tab+item
    existing = con.execute(
        "SELECT id, qty_used FROM estimate_entry WHERE month_num=? AND product_tab=? AND item_id=?",
        (payload.month_num, tab, payload.item_id),
    ).fetchone()
    if existing:
        new_qty = existing["qty_used"] + payload.qty
        con.execute("UPDATE estimate_entry SET qty_used=? WHERE id=?", (new_qty, existing["id"]))
        con.commit()
        entry = dbmod.get_estimate_entries(con, payload.month_num)
    else:
        entry = dbmod.create_estimate_entry(
            con,
            month_num=payload.month_num,
            product_tab=tab,
            item_id=payload.item_id,
            item_name=item["name"],
            qty_used=payload.qty,
        )
        dbmod.get_estimate_entries(con, payload.month_num)
    try:
        from app.sheets_estimate import sync_estimate_sheet
        sheet_url = sync_estimate_sheet(con, payload.month_num, tab)
    except Exception as exc:
        sheet_url = f"(sheet sync skipped: {exc})"
    return {"status": "ok", "month_num": payload.month_num, "tab": tab, "entry": entry, "sheet_url": sheet_url}


@app.post("/api/estimate/clear_all")
def estimate_clear_all(con: sqlite3.Connection = Depends(get_db)):
    """Clear all estimate item rows in Google Sheet while preserving summary rows."""
    from app.sheets_estimate import clear_all_estimate_items
    clear_all_estimate_items(con)
    return {"status": "cleared"}


@app.post("/api/estimate/add_summary")
def estimate_add_summary(con: sqlite3.Connection = Depends(get_db)):
    """Insert the 4 summary rows into every month block of every estimate tab.
    Returns count of rows added per tab.
    """
    from app.sheets_estimate import add_summary_rows_to_estimate
    result = add_summary_rows_to_estimate(con)
    return result


# Old JSON endpoint kept for API consumers
class EstimateRow(BaseModel):
    item_id: int
    qty: float


# Old batch endpoint removed: single-row POST /api/estimate replaces it.

# ---- HTMX UI routes ----
@app.get("/ui/inventory", response_class=HTMLResponse)
def ui_inventory(request: Request, con: sqlite3.Connection = Depends(get_db)):
    items = dbmod.get_all_items(con)
    return templates.TemplateResponse(
        request, "inventory.html",
        {"items": items, "active": "inventory", "product_tabs": gsheets.PRODUCT_TABS},
    )


@app.post("/ui/inventory", response_class=HTMLResponse)
def ui_create_inventory(
    request: Request,
    name: str = Form(...),
    qty: float = Form(0),
    unit_cost: float = Form(0),
    product_tab: str = Form(""),
    con: sqlite3.Connection = Depends(get_db),
):
    dbmod.create_item(con, name.strip(), qty, unit_cost, product_tab or None)
    # Sync newly added item to Google Sheets
    from app import sheets as gsheets
    gsheets.sync_inventory_sheet(con)
    items = dbmod.get_all_items(con)
    return templates.TemplateResponse(
        request, "inventory.html",
        {"items": items, "active": "inventory", "msg": f"{name} ditambah.",
         "product_tabs": gsheets.PRODUCT_TABS},
    )


@app.get("/ui/inventory/{item_id}/edit", response_class=HTMLResponse)
def ui_edit_form(item_id: int, request: Request, con: sqlite3.Connection = Depends(get_db)):
    item = dbmod.get_item(con, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return templates.TemplateResponse(
        request, "inventory_edit.html",
        {"item": item, "active": "inventory", "product_tabs": gsheets.PRODUCT_TABS},
    )


@app.post("/ui/inventory/{item_id}/edit")
def ui_edit_save(
    item_id: int,
    qty: float = Form(...),
    unit_cost: float = Form(...),
    product_tab: str = Form(""),
    con: sqlite3.Connection = Depends(get_db),
):
    item = dbmod.update_item(con, item_id, qty=qty, unit_cost=unit_cost, product_tab=product_tab or None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return RedirectResponse(url="/ui/inventory", status_code=302)


@app.post("/ui/inventory/{item_id}/delete")
def ui_delete(item_id: int, con: sqlite3.Connection = Depends(get_db)):
    ok = dbmod.delete_item(con, item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Item not found")
    return RedirectResponse(url="/ui/inventory", status_code=302)


@app.get("/ui/estimate", response_class=HTMLResponse)
def ui_estimate_get(request: Request, con: sqlite3.Connection = Depends(get_db)):
    items = dbmod.get_all_items(con)
    return templates.TemplateResponse(request, "estimate.html", {"items": items, "active": "estimate"})


@app.post("/ui/estimate", response_class=HTMLResponse)
async def ui_estimate_post(request: Request, con: sqlite3.Connection = Depends(get_db)):
    """Form POST handler for the Estimate page.

    The estimate.html form submits urlencoded data (not JSON), so it cannot
    hit /api/estimate directly. This endpoint parses the form, runs the same
    logic as submit_estimate, and returns an HTML fragment for HTMX to swap
    into #estimate-result.
    """
    form = await request.form()
    try:
        payload = EstimateSubmit(
            month_num=int(form.get("month_num", "1")),
            diameter=form.get("diameter") or None,
            product_tab=form.get("product_tab", ""),
            item_id=int(form.get("item_id", "0")),
            qty=float(form.get("qty", "0")),
        )
    except (ValueError, TypeError) as exc:
        return templates.TemplateResponse(
            request, "estimate_result.html",
            {"error": f"Invalid form data: {exc}", "active": "estimate"},
        )
    # Reuse the same logic as /api/estimate via the shared helper
    tab, error, ctx = _record_estimate(con, payload)
    if error:
        return templates.TemplateResponse(
            request, "estimate_result.html", {"error": error, "active": "estimate"},
        )
    sheet_url = _sync_estimate_or_note(con, payload.month_num, tab)
    return templates.TemplateResponse(
        request, "estimate_result.html", {**ctx, "sheet_url": sheet_url, "active": "estimate"},
    )


@app.get("/ui/cogs", response_class=HTMLResponse)
def ui_cogs_get(request: Request, con: sqlite3.Connection = Depends(get_db)):
    items = dbmod.get_all_items(con)
    rows = [
        {"nama_bahan": it["name"], "harga_kg": it["unit_cost"], "pemakaian_gram": 0}
        for it in items
    ]
    return templates.TemplateResponse(
        request, "cogs.html",
        {"rows": rows, "summary": None, "active": "cogs",
         "month_preset": None, "months": None},
    )


@app.post("/ui/cogs", response_class=HTMLResponse)
async def ui_cogs_post(request: Request, con: sqlite3.Connection = Depends(get_db)):
    form = await request.form()
    # Parse row_N_nama / row_N_kg / row_N_gram + optional new_* rows
    indexed: dict[int, dict] = {}
    for k, v in form.items():
        if k.startswith("row_"):
            # row_{i}_{field}
            try:
                _, idx_s, field = k.split("_", 2)
                idx = int(idx_s)
            except ValueError:
                continue
            indexed.setdefault(idx, {})[field] = v
    rows = []
    for idx in sorted(indexed):
        d = indexed[idx]
        nama = str(d.get("nama", "")).strip()
        if not nama:
            continue
        try:
            kg = float(d.get("kg", 0) or 0)
        except ValueError:
            kg = 0
        try:
            gram = float(d.get("gram", 0) or 0)
        except ValueError:
            gram = 0
        rows.append({"nama_bahan": nama, "harga_kg": kg, "pemakaian_gram": gram})
    # new_* single extra row
    new_nama = str(form.get("new_nama", "") or "").strip()
    if new_nama:
        try:
            kg = float(form.get("new_kg", 0) or 0)
        except ValueError:
            kg = 0
        try:
            gram = float(form.get("new_gram", 0) or 0)
        except ValueError:
            gram = 0
        rows.append({"nama_bahan": new_nama, "harga_kg": kg, "pemakaian_gram": gram})
    summary = compute_cogs(rows) if rows else None
    # Build combined-style summary wrapper for template
    if summary:
        summary = {"combined": summary, "per_tab": {}, "month_preset": None}
    return templates.TemplateResponse(
        request, "cogs.html",
        {"rows": rows, "summary": summary, "active": "cogs",
         "month_preset": None, "months": None},
    )


# ── Monthly COGS HTMX fragment endpoint ──────────────────────────────────
@app.get("/ui/cogs/monthly", response_class=HTMLResponse)
def ui_cogs_monthly(request: Request, month: int = 1, con: sqlite3.Connection = Depends(get_db)):
    """HTMX endpoint: render monthly COGS fragment for selected month."""
    summary = gsheets.get_monthly_cogs(con, month)
    # Use HTMLResponse, not TemplateResponse, so the fragment has no layout/base wrapper.
    # Manually render the Jinja2 template to keep it a pure fragment.
    return HTMLResponse(
        templates.env.get_template("cogs_fragment.html").render(
            summary=summary, month_preset=month
        )
    )


# ── Google Sheets sync endpoints ────────────────────────────────────────
@app.get("/api/sheets/status")
def sheets_status():
    """Health check: is Google token present + sheet reachable?"""
    import os
    token_exists = os.path.exists("/opt/data/profiles/developer/google_token.json")
    try:
        cfg = gsheets._load_config()
        tabs = cfg.get("product_tabs", [])
        return {
            "token_present": token_exists,
            "sheet_id": "1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA",
            "product_tabs": tabs,
            "bahan_count": len(cfg.get("bahan_sorted", [])),
        }
    except Exception as e:
        return {"token_present": token_exists, "error": str(e)}


@app.post("/api/sheets/sync/sheet-to-db")
def sheets_sync_to_db(con: sqlite3.Connection = Depends(get_db)):
    """Pull inventory prices from Google Sheet → local DB."""
    synced = gsheets.sync_sheet_to_db(con)
    return {"synced_bahan": len(synced), "sample": dict(list(synced.items())[:5])}


@app.post("/api/sheets/sync/db-to-sheet")
def db_sync_to_sheet(con: sqlite3.Connection = Depends(get_db)):
    """Push inventory prices from local DB → Google Sheet."""
    result = gsheets.sync_db_to_sheet(con)
    # clean stray merges, then apply consistent formatting
    svc = gsheets._get_service()
    gsheets.clean_extra_merges(svc, gsheets.SHEET_ID)
    gsheets.apply_formatting_all(svc, gsheets.SHEET_ID)
    return result


@app.post("/api/sheets/sync/inventory")
def inventory_sync(con: sqlite3.Connection = Depends(get_db)):
    """Push inventory DB rows to a dedicated Inventory Google Sheet.
    Returns the sheet URL.
    """
    url = gsheets.sync_inventory_sheet(con)
    return {"inventory_sheet_url": url}


@app.get("/api/sheets/cogs/{month_num}")
def sheets_cogs(month_num: int, con: sqlite3.Connection = Depends(get_db)):
    """Get monthly COGS (1=Jan, ..., 12=Dec) pulled from all product tabs."""
    if month_num < 1 or month_num > 12:
        raise HTTPException(status_code=400, detail="month_num must be 1-12")
    result = gsheets.get_monthly_cogs(con, month_num)
    if not result:
        return {"month": month_num, "rows": [], "note": "No data for this month"}
    # result now has {month, month_name, per_tab, combined}
    return result


@app.get("/ui/sheets", response_class=HTMLResponse)
def ui_sheets(request: Request):
    """Show sync status + quick actions page."""
    import os
    token_path = "/opt/data/profiles/developer/google_token.json"
    token_present = os.path.exists(token_path)
    return templates.TemplateResponse(
        request, "sheets_sync.html",
        {
            "active": "sheets",
            "token_present": token_present,
            "sheet_id": "1wA5WN0evR5VpMujKphfY7441T80bEz6OjH0EOnOW1JA",
            "product_tabs": gsheets.PRODUCT_TABS,
        },
    )


@app.post("/ui/sheets/sync/all")
def ui_sheets_sync_all(request: Request, con: sqlite3.Connection = Depends(get_db)):
    """Sync sheet → DB, then DB → sheet. Returns JSON summary."""
    pulled = gsheets.sync_sheet_to_db(con)
    pushed = gsheets.sync_db_to_sheet(con)
    return {"pulled_bahan": len(pulled), "pushed_cells": pushed.get("cells_updated", 0)}
