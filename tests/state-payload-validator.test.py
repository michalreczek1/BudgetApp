from copy import deepcopy
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


def build_valid_payload():
    payload = deepcopy(server.DEFAULT_STATE)
    payload.pop("pin", None)
    payload["version"] = 1
    payload["balance"] = 1234.56
    payload["payments"] = [
        {
            "id": 101,
            "name": "Czynsz",
            "amount": 1500.0,
            "date": "2026-02-01",
            "frequency": "monthly",
            "type": "expense",
            "months": [],
            "paidDates": ["2026-02-01"],
        },
        {
            "id": 102,
            "name": "OC Auto",
            "amount": 600.0,
            "date": "2026-01-15",
            "frequency": "selected",
            "type": "expense",
            "months": [1, 7],
            "paidDates": [],
        },
    ]
    payload["incomes"] = [
        {
            "id": 201,
            "name": "Pensja",
            "amount": 5000.0,
            "date": "2026-02-10",
            "frequency": "monthly",
            "type": "income",
            "receivedDates": ["2026-02-10"],
            "category": "premia",
        },
        {
            "id": 202,
            "name": "Zwrot",
            "amount": 120.0,
            "date": "2026-02-20",
            "frequency": "once",
            "type": "income",
            "receivedDates": [],
            "category": "inne",
        },
    ]
    payload["expenseEntries"] = [
        {
            "id": 301,
            "amount": 42.5,
            "category": "jedzenie",
            "date": "2026-02-11",
            "source": "manual",
            "name": "Zakupy",
            "icon": "🍽️",
        }
    ]
    payload["incomeEntries"] = [
        {
            "id": 401,
            "amount": 100.0,
            "category": "premia",
            "date": "2026-02-12",
            "source": "balance-update",
            "name": "Korekta salda",
            "icon": "🎁",
        }
    ]
    payload["expenseCategoryTotals"] = {"jedzenie": 42.5}
    payload["incomeCategoryTotals"] = {"premia": 100.0}
    return payload


def assert_no_errors(errors, context):
    if errors:
        raise AssertionError(f"{context}: expected no validation errors, got {errors}")


def test_accepts_frontend_style_payload():
    payload = build_valid_payload()
    errors = server.validate_state_payload(payload)
    assert_no_errors(errors, "frontend-style payload")


def test_rejects_unknown_income_field():
    payload = build_valid_payload()
    payload["incomes"][0]["unexpected"] = "x"
    errors = server.validate_state_payload(payload)
    fields = {err.get("field") for err in errors}
    if "incomes[0].unexpected" not in fields:
        raise AssertionError(f"expected unknown-field error, got {errors}")


if __name__ == "__main__":
    test_accepts_frontend_style_payload()
    test_rejects_unknown_income_field()
    print("state payload validator tests: OK")
