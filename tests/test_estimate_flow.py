"""
TDD tests for Estimate input flow.
RED cycle: these fail until estimate_entry + decrement_stock are implemented.
"""
import sqlite3

from app import database as dbmod


def _mem_con():
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.row_factory = sqlite3.Row
    dbmod.init_db(con)
    return con


def test_create_estimate_decrements_stock():
    """Estimate entry creation must decrease inventory qty."""
    con = _mem_con()
    item = dbmod.create_item(con, name="Test Bahan", qty=1000.0, unit_cost=20000.0)
    entry = dbmod.create_estimate_entry(
        con, month_num=1, product_tab="CAKE 18 CM",
        item_id=item["id"], item_name=item["name"], qty_used=250.0,
    )
    assert entry["qty_used"] == 250.0
    ok = dbmod.decrement_stock(con, item["id"], 250.0)
    assert ok is True
    updated = dbmod.get_item(con, item["id"])
    assert updated["qty"] == 750.0


def test_decrement_negative_blocked():
    """If decrement would go negative, return False and keep stock."""
    con = _mem_con()
    item = dbmod.create_item(con, name="Low Stock", qty=100.0, unit_cost=5000.0)
    result = dbmod.decrement_stock(con, item["id"], 500.0)
    assert result is False
    updated = dbmod.get_item(con, item["id"])
    assert updated["qty"] == 100.0


def test_get_estimate_entries_by_month():
    """Estimate entries retrievable per month."""
    con = _mem_con()
    item = dbmod.create_item(con, name="Tepung", qty=500.0, unit_cost=15000.0)
    dbmod.create_estimate_entry(
        con, month_num=3, product_tab="CAKE 20 CM",
        item_id=item["id"], item_name=item["name"], qty_used=50.0,
    )
    got = dbmod.get_estimate_entries(con, month_num=3)
    assert len(got) == 1
    assert got[0]["item_name"] == "Tepung"
    assert got[0]["month_num"] == 3
    assert dbmod.get_estimate_entries(con, month_num=4) == []
