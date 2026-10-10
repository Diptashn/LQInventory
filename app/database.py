# Database layer: SQLite schema + helpers
import os
import sqlite3
import json
from datetime import datetime, timezone
from typing import Generator, Optional, List, Dict, Any

DB_PATH = os.environ.get("INVENTORY_DB", "inventory.db")


SCHEMA = """
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    product_tab TEXT,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(name);

CREATE TABLE IF NOT EXISTS sheet_sync_log (
    log_key TEXT PRIMARY KEY,
    product_tab TEXT NOT NULL,
    bahan_name TEXT NOT NULL,
    month_num INTEGER NOT NULL,
    harga_kg REAL NOT NULL DEFAULT 0,
    pemakaian_gram REAL NOT NULL DEFAULT 0,
    total_bahan REAL NOT NULL DEFAULT 0,
    ongkos_produksi REAL NOT NULL DEFAULT 0,
    total_modal REAL NOT NULL DEFAULT 0,
    total_estimasi REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_log_month ON sheet_sync_log(month_num);

CREATE TABLE IF NOT EXISTS estimate_entry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_num INTEGER NOT NULL,
    product_tab TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    qty_used REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_estimate_month ON estimate_entry(month_num);
CREATE INDEX IF NOT EXISTS idx_estimate_item ON estimate_entry(item_id);
"""


def init_db(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)
    con.commit()
    # Migrate legacy DBs created before product_tab existed.
    # SCHEMA's CREATE TABLE is a no-op on existing tables, so add the
    # column explicitly, then create the index (kept out of SCHEMA so
    # executescript never fails on legacy files).
    try:
        cols = [r[1] for r in con.execute("PRAGMA table_info(inventory)").fetchall()]
        if "product_tab" not in cols:
            con.execute("ALTER TABLE inventory ADD COLUMN product_tab TEXT")
            con.commit()
    except Exception:
        pass
    con.execute("CREATE INDEX IF NOT EXISTS idx_inventory_tab ON inventory(product_tab)")
    con.commit()


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat() + "Z"


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


DIAMETER_TO_TAB = {"18 CM": "CAKE 18 CM", "20 CM": "CAKE 20 CM", "24 CM": "CAKE 24 CM"}

def resolve_product_tab(diameter_or_tab: str) -> str:
    """Map diameter dropdown value to sheet tab. Pass-through if already a tab."""
    v = (diameter_or_tab or "").strip().upper().replace("18CM", "18 CM").replace("20CM", "20 CM").replace("24CM", "24 CM")
    # normalize: allow "18", "18 cm", "18CM"
    if v in DIAMETER_TO_TAB:
        return DIAMETER_TO_TAB[v]
    # allow "18" -> "18 CM"
    if v in ("18", "20", "24"):
        v = f"{v} CM"
        return DIAMETER_TO_TAB.get(v, v)
    # already a CAKE xx CM tab or other tab name
    cleaned = (diameter_or_tab or "").strip()
    if cleaned.upper() in [k.upper() for k in DIAMETER_TO_TAB.values()]:
        # return canonical casing
        for k, tab in DIAMETER_TO_TAB.items():
            if cleaned.upper() == tab.upper():
                return tab
        return cleaned
    return cleaned


def clean_name(raw: str) -> str:
    """Normalize a bahan/item name: strip whitespace, collapse inner spaces, sentence case.

    Same words with different capitalization (e.g. 'TEPUNG terigu' vs
    'tepung TERIGU') are treated as identical and stored sentence case.
    """
    s = " ".join((raw or "").split())
    if not s:
        return s
    return s[0].upper() + s[1:].lower()


def create_item(con: sqlite3.Connection, name: str, qty: float, unit_cost: float, product_tab: Optional[str] = None) -> Dict[str, Any]:
    now = _now_iso()
    name = clean_name(name)
    # Merge duplicates: same cleaned name adds qty together, latest price wins.
    existing = con.execute(
        "SELECT * FROM inventory WHERE name = ?", (name,)
    ).fetchone()
    if existing:
        new_qty = (existing["qty"] or 0) + (qty or 0)
        con.execute(
            "UPDATE inventory SET qty = ?, unit_cost = ?, updated_at = ? WHERE id = ?",
            (new_qty, unit_cost, now, existing["id"]),
        )
        con.commit()
        return get_item(con, existing["id"])
    cur = con.execute(
        "INSERT INTO inventory (name, qty, unit_cost, product_tab, updated_at) VALUES (?, ?, ?, ?, ?)",
        (name, qty, unit_cost, product_tab, now),
    )
    con.commit()
    item_id = cur.lastrowid
    return get_item(con, item_id)


def get_item(con: sqlite3.Connection, item_id: int) -> Optional[Dict[str, Any]]:
    cur = con.execute("SELECT * FROM inventory WHERE id = ?", (item_id,))
    row = cur.fetchone()
    return _row_to_dict(row) if row else None


def get_all_items(con: sqlite3.Connection) -> List[Dict[str, Any]]:
    cur = con.execute("SELECT * FROM inventory ORDER BY name")
    return [_row_to_dict(row) for row in cur.fetchall()]


def update_item(
    con: sqlite3.Connection, item_id: int, name: Optional[str] = None, qty: Optional[float] = None, unit_cost: Optional[float] = None, product_tab: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    item = get_item(con, item_id)
    if not item:
        return None
    new_name = clean_name(name) if name is not None else item["name"]
    new_qty = qty if qty is not None else item["qty"]
    new_unit = unit_cost if unit_cost is not None else item["unit_cost"]
    new_tab = product_tab if product_tab is not None else item.get("product_tab")
    now = _now_iso()
    con.execute(
        "UPDATE inventory SET name = ?, qty = ?, unit_cost = ?, product_tab = ?, updated_at = ? WHERE id = ?",
        (new_name, new_qty, new_unit, new_tab, now, item_id),
    )
    con.commit()
    return get_item(con, item_id)


def delete_item(con: sqlite3.Connection, item_id: int) -> bool:
    cur = con.execute("DELETE FROM inventory WHERE id = ?", (item_id,))
    con.commit()
    return cur.rowcount > 0


def get_db() -> Generator[sqlite3.Connection, None, None]:
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    init_db(con)
    try:
        yield con
    finally:
        con.close()


def create_estimate_entry(
    con: sqlite3.Connection, month_num: int, product_tab: str,
    item_id: int, item_name: str, qty_used: float,
) -> Dict[str, Any]:
    """Record one estimate usage row. Item name cleaned to sentence case.

    Duplicate inputs (same month + product tab + item) aggregate: qty_used
    is summed into the existing row instead of creating a duplicate.
    """
    now = _now_iso()
    item_name = clean_name(item_name)
    existing = con.execute(
        "SELECT id, qty_used FROM estimate_entry WHERE month_num=? AND product_tab=? AND item_id=?",
        (month_num, product_tab, item_id),
    ).fetchone()
    if existing:
        new_qty = existing["qty_used"] + qty_used
        con.execute(
            "UPDATE estimate_entry SET qty_used=?, created_at=? WHERE id=?",
            (new_qty, now, existing["id"]),
        )
        con.commit()
        row = con.execute("SELECT * FROM estimate_entry WHERE id = ?", (existing["id"],)).fetchone()
        return dict(row)
    cur = con.execute(
        "INSERT INTO estimate_entry (month_num, product_tab, item_id, item_name, qty_used, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (month_num, product_tab, item_id, item_name, qty_used, now),
    )
    con.commit()
    row = con.execute("SELECT * FROM estimate_entry WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


def get_estimate_entries(con: sqlite3.Connection, month_num: int) -> List[Dict[str, Any]]:
    cur = con.execute(
        "SELECT * FROM estimate_entry WHERE month_num = ? ORDER BY product_tab, item_name",
        (month_num,),
    )
    return [dict(r) for r in cur.fetchall()]


def decrement_stock(con: sqlite3.Connection, item_id: int, qty_used: float) -> bool:
    """Decrease inventory qty by qty_used. Returns False if item missing or would go negative."""
    item = get_item(con, item_id)
    if not item:
        return False
    new_qty = item["qty"] - qty_used
    if new_qty < 0:
        return False
    con.execute(
        "UPDATE inventory SET qty = ?, updated_at = ? WHERE id = ?",
        (new_qty, _now_iso(), item_id),
    )
    con.commit()
    return True