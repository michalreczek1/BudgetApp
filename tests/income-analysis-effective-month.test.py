from copy import deepcopy
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


def build_state():
    payload = deepcopy(server.DEFAULT_STATE)
    payload["incomeEntries"] = [
        {
            "id": 1,
            "amount": 5000.0,
            "category": "premia",
            "date": "2026-02-28",
            "source": "balance-update",
            "name": "Pensja luty",
            "icon": "🎁",
        },
        {
            "id": 2,
            "amount": 300.0,
            "category": "premia",
            "date": "2026-02-28",
            "source": "balance-update",
            "name": "Premia luty",
            "icon": "🎁",
        },
        {
            "id": 3,
            "amount": 1200.0,
            "category": "premia",
            "date": "2026-03-28",
            "source": "balance-update",
            "name": "Wynagrodzenie marzec",
            "icon": "🎁",
        },
    ]
    payload["incomeCategoryTotals"] = {"premia": 6500.0}
    return payload


def test_income_analysis_uses_effective_month_for_salary_entries():
    original_db_path = server.DB_PATH

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            server.DB_PATH = Path(temp_dir) / "income-effective-month.db"
            server.init_db()
            server.write_state(build_state())

            february = server.read_transactions_for_month("income", "2026-02")
            march = server.read_transactions_for_month("income", "2026-03")
            april = server.read_transactions_for_month("income", "2026-04")

            february_names = {entry["name"] for entry in february["entries"]}
            march_names = {entry["name"] for entry in march["entries"]}
            april_names = {entry["name"] for entry in april["entries"]}

            assert "Pensja luty" not in february_names
            assert "Premia luty" in february_names
            assert february["totalAmount"] == 300.0

            assert "Pensja luty" in march_names
            assert "Wynagrodzenie marzec" not in march_names
            assert march["totalAmount"] == 5000.0

            assert "Wynagrodzenie marzec" in april_names
            assert april["totalAmount"] == 1200.0
    finally:
        server.DB_PATH = original_db_path


if __name__ == "__main__":
    test_income_analysis_uses_effective_month_for_salary_entries()
    print("income analysis effective month tests: OK")
