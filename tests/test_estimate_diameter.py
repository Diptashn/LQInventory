"""TDD: diameter->tab mapping + estimate aggregation (dup qty sums)."""
import sqlite3
from app import database as dbmod

DIAMETER_TO_TAB = {"18 CM": "CAKE 18 CM", "20 CM": "CAKE 20 CM", "24 CM": "CAKE 24 CM"}


def _mem_con():
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.row_factory = sqlite3.Row
    dbmod.init_db(con)
    return con


def test_diameter_maps_to_product_tab():
    """Diameter dropdown values must resolve to the correct sheet tab."""
    for dia, tab in DIAMETER_TO_TAB.items():
        assert dbmod.resolve_product_tab(dia) == tab


def test_estimate_duplicate_qty_aggregates():
    """Same month+tab+item entered twice sums qty_used into one row."""
    con = _mem_con()
    item = dbmod.create_item(con, name="Tepung", qty=5000.0, unit_cost=15000.0)
    dbmod.create_estimate_entry(con, month_num=2, product_tab="CAKE 18 CM",
                                item_id=item["id"], item_name=item["name"], qty_used=200.0)
    dbmod.create_estimate_entry(con, month_num=2, product_tab="CAKE 18 CM",
                                item_id=item["id"], item_name=item["name"], qty_used=150.0)
    got = dbmod.get_estimate_entries(con, month_num=2)
    assert len(got) == 1
    assert got[0]["qty_used"] == 350.0
