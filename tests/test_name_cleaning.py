"""TDD: names are cleaned to sentence case on create/update/estimate."""
import sqlite3

from app import database as dbmod


def _mem_con():
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.row_factory = sqlite3.Row
    dbmod.init_db(con)
    return con


def test_create_sentence_case():
    con = _mem_con()
    item = dbmod.create_item(con, name="tEpUNG tERigu", qty=10.0, unit_cost=15000.0)
    assert item["name"] == "Tepung terigu"


def test_create_strips_whitespace():
    con = _mem_con()
    item = dbmod.create_item(con, name="  Gula Pasir  ", qty=5.0, unit_cost=12000.0)
    assert item["name"] == "Gula pasir"


def test_update_name_sentence_case():
    con = _mem_con()
    item = dbmod.create_item(con, name="Tepung", qty=10.0, unit_cost=15000.0)
    updated = dbmod.update_item(con, item["id"], name="gULA mERAH")
    assert updated["name"] == "Gula merah"


def test_estimate_item_name_sentence_case():
    con = _mem_con()
    item = dbmod.create_item(con, name="Mentega", qty=1000.0, unit_cost=20000.0)
    entry = dbmod.create_estimate_entry(
        con, month_num=1, product_tab="CAKE 18 CM",
        item_id=item["id"], item_name="mENTEGA cair", qty_used=100.0,
    )
    assert entry["item_name"] == "Mentega cair"
