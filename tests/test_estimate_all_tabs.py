"""TDD: estimate dropdown covers all 9 product tabs, not just cake diameters."""
import sqlite3
from app import database as dbmod

ALL_TABS = [
    "CAKE 18 CM", "CAKE 20 CM", "CAKE 24 CM", "cupcake 18pcs",
    "wedding dummy", "LAPSUR", "RAINBOW", "hampers", "ITALIAN",
]


def _mem_con():
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.row_factory = sqlite3.Row
    dbmod.init_db(con)
    return con


def test_resolve_product_tab_passthrough_for_all_tabs():
    """Every product tab name must round-trip through resolve_product_tab."""
    for tab in ALL_TABS:
        assert dbmod.resolve_product_tab(tab) == tab


def test_resolve_product_tab_still_maps_cake_diameters():
    """Legacy diameter values keep mapping to their cake tab."""
    assert dbmod.resolve_product_tab("18 CM") == "CAKE 18 CM"
    assert dbmod.resolve_product_tab("20 CM") == "CAKE 20 CM"
    assert dbmod.resolve_product_tab("24 CM") == "CAKE 24 CM"


def test_estimate_entry_accepts_non_cake_tabs():
    """Non-cake tabs (LAPSUR, hamper, etc.) must store estimate rows."""
    con = _mem_con()
    item = dbmod.create_item(con, name="Fondant", qty=2000.0, unit_cost=90000.0)
    dbmod.create_estimate_entry(con, month_num=4, product_tab="LAPSUR",
                                item_id=item["id"], item_name=item["name"], qty_used=300.0)
    dbmod.create_estimate_entry(con, month_num=4, product_tab="hampers",
                                item_id=item["id"], item_name=item["name"], qty_used=120.0)
    got = dbmod.get_estimate_entries(con, month_num=4)
    tabs = sorted(r["product_tab"] for r in got)
    assert tabs == ["LAPSUR", "hampers"]


def test_same_item_different_tabs_do_not_merge():
    """Aggregation is per-tab: same item in 2 tabs = 2 rows."""
    con = _mem_con()
    item = dbmod.create_item(con, name="Gula Pasir", qty=9000.0, unit_cost=14000.0)
    dbmod.create_estimate_entry(con, month_num=5, product_tab="CAKE 18 CM",
                                item_id=item["id"], item_name=item["name"], qty_used=100.0)
    dbmod.create_estimate_entry(con, month_num=5, product_tab="ITALIAN",
                                item_id=item["id"], item_name=item["name"], qty_used=250.0)
    got = dbmod.get_estimate_entries(con, month_num=5)
    assert len(got) == 2