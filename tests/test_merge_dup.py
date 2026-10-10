"""TDD: duplicate names merge qty (sentence-case insensitive)."""
import sqlite3
from app import database as dbmod

def _mem_con():
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.row_factory = sqlite3.Row
    dbmod.init_db(con)
    return con

def test_duplicate_name_adds_qty():
    con = _mem_con()
    a = dbmod.create_item(con, name="Tepung terigu", qty=1000.0, unit_cost=15000.0)
    b = dbmod.create_item(con, name="TEPUNG TERIGU", qty=500.0, unit_cost=15000.0)
    assert b["id"] == a["id"], "same item should merge, not duplicate"
    assert b["qty"] == 1500.0
    all_items = dbmod.get_all_items(con)
    assert len(all_items) == 1

def test_duplicate_updates_price_to_latest():
    con = _mem_con()
    dbmod.create_item(con, name="Gula pasir", qty=100.0, unit_cost=12000.0)
    b = dbmod.create_item(con, name="gula PASIR", qty=50.0, unit_cost=13000.0)
    assert b["qty"] == 150.0
    assert b["unit_cost"] == 13000.0
