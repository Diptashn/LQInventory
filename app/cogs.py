# COGS computation: harga_gram = harga_kg / 1000, harga_total = harga_gram * pemakaian_gram
# ongkos_produksi = 40% of total_bahan (configurable per product via ONGKOS_BY_TAB)
from typing import List, Dict, Any


ONGKOS_RATE = 0.40  # default 40% (legacy)

# Per-product ongkos rates: 40% for cake & specialty items, 30% for lapsed/rainbow/hampers
ONGKOS_BY_TAB = {
    "CAKE 18 CM": 0.40,
    "CAKE 20 CM": 0.40,
    "CAKE 24 CM": 0.40,
    "cupcake 18pcs": 0.40,
    "wedding dummy": 0.40,
    "LAPSUR": 0.30,
    "RAINBOW": 0.30,
    "hampers": 0.30,
    "ITALIAN": 0.40,
}


def get_ongkos_rate(tab: str) -> float:
    """Return per-product ongkos rate (0.30 or 0.40), defaults to ONGKOS_RATE."""
    return ONGKOS_BY_TAB.get(tab, ONGKOS_RATE)


def compute_cogs(rows: List[Dict[str, Any]], ongkos_rate: float = ONGKOS_RATE) -> Dict[str, Any]:
    """
    rows: each dict with nama_bahan, harga_kg, pemakaian_gram
    returns: dict with rows (enriched), total_bahan, ongkos_produksi, total_modal, total_estimasi
    """
    enriched = []
    total_bahan = 0.0

    for r in rows:
        harga_kg = float(r.get("harga_kg", 0))
        pemakaian = float(r.get("pemakaian_gram", 0))
        harga_gram = harga_kg / 1000.0
        harga_total = harga_gram * pemakaian
        total_bahan += harga_total
        enriched.append({
            "nama_bahan": r.get("nama_bahan", ""),
            "harga_kg": harga_kg,
            "harga_gram": round(harga_gram, 2),
            "pemakaian_gram": pemakaian,
            "harga_total": round(harga_total, 2),
        })

    ongkos_produksi = round(total_bahan * ongkos_rate, 2)
    total_modal = round(total_bahan + ongkos_produksi, 2)
    total_estimasi = total_modal  # alias per spec

    return {
        "rows": enriched,
        "total_bahan": round(total_bahan, 2),
        "ongkos_produksi": ongkos_produksi,
        "total_modal": total_modal,
        "total_estimasi": total_estimasi,
    }


def format_for_sheet(cogs: Dict[str, Any]) -> List[List[Any]]:
    """
    Convert COGS result to Google Sheets range A1 format:
    Row 1: headers (handled separately)
    Data rows: nama_bahan, harga_kg, harga_gram, pemakaian_gram, harga_total
    Summary rows: total_bahan, ongkos_produksi, total_modal, total_estimasi
    """
    data = []
    for row in cogs["rows"]:
        data.append([
            row["nama_bahan"],
            row["harga_kg"],
            row["harga_gram"],
            row["pemakaian_gram"],
            row["harga_total"],
        ])
    # Summary rows (empty name, value in last col or as separate rows)
    data.append(["total_bahan", "", "", "", cogs["total_bahan"]])
    data.append(["ongkos_produksi (40%)", "", "", "", cogs["ongkos_produksi"]])
    data.append(["total_modal", "", "", "", cogs["total_modal"]])
    data.append(["total_estimasi", "", "", "", cogs["total_estimasi"]])
    return data