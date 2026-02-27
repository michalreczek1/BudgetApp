from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


def base_state():
    payload = deepcopy(server.DEFAULT_STATE)
    payload.pop("pin", None)
    payload["version"] = 1
    payload["balance"] = 1000.0
    return payload


def test_manual_payment_before_due_books_today_and_blocks_auto_duplicate():
    state = base_state()
    state["payments"] = [
        {
            "id": 101,
            "name": "Rata",
            "amount": 300.0,
            "date": "2026-03-20",
            "frequency": "monthly",
            "type": "expense",
            "months": [],
            "paidDates": [],
        }
    ]

    with patch("server.app_now", return_value=datetime(2026, 3, 10, 9, 0, tzinfo=timezone.utc)):
        manual_state, manual_summary, _ = server.apply_server_settlement(
            state,
            "manual-payment-101-2026-03-20",
        )

    assert manual_summary["changed"] is True
    assert manual_summary["settledPayments"] == 1
    assert len(manual_state["expenseEntries"]) == 1
    assert manual_state["expenseEntries"][0]["date"] == "2026-03-10"
    assert manual_state["expenseEntries"][0]["source"] == "planned-payment"
    assert "2026-03-20" in manual_state["payments"][0]["paidDates"]

    with patch("server.app_now", return_value=datetime(2026, 3, 21, 13, 0, tzinfo=timezone.utc)):
        auto_state, auto_summary, _ = server.apply_server_settlement(manual_state, "auto")

    assert auto_summary["changed"] is False
    assert auto_summary["settledPayments"] == 0
    assert len(auto_state["expenseEntries"]) == 1


def test_manual_income_before_due_books_today_and_blocks_auto_duplicate():
    state = base_state()
    state["incomes"] = [
        {
            "id": 201,
            "name": "Pensja",
            "amount": 5000.0,
            "date": "2026-03-15",
            "frequency": "monthly",
            "type": "income",
            "receivedDates": [],
            "category": "premia",
        }
    ]

    with patch("server.app_now", return_value=datetime(2026, 3, 10, 9, 0, tzinfo=timezone.utc)):
        manual_state, manual_summary, _ = server.apply_server_settlement(
            state,
            "manual-income-201-2026-03-15",
        )

    assert manual_summary["changed"] is True
    assert manual_summary["settledIncomes"] == 1
    assert len(manual_state["incomeEntries"]) == 1
    assert manual_state["incomeEntries"][0]["date"] == "2026-03-10"
    assert manual_state["incomeEntries"][0]["source"] == "planned-income"
    assert "2026-03-15" in manual_state["incomes"][0]["receivedDates"]

    with patch("server.app_now", return_value=datetime(2026, 3, 16, 13, 0, tzinfo=timezone.utc)):
        auto_state, auto_summary, _ = server.apply_server_settlement(manual_state, "auto")

    assert auto_summary["changed"] is False
    assert auto_summary["settledIncomes"] == 0
    assert len(auto_state["incomeEntries"]) == 1


def test_manual_once_payment_is_removed_after_booking():
    state = base_state()
    state["payments"] = [
        {
            "id": 301,
            "name": "Jednorazowy zakup",
            "amount": 120.0,
            "date": "2026-03-25",
            "frequency": "once",
            "type": "expense",
            "months": [],
            "paidDates": [],
        }
    ]

    with patch("server.app_now", return_value=datetime(2026, 3, 10, 8, 0, tzinfo=timezone.utc)):
        manual_state, manual_summary, _ = server.apply_server_settlement(
            state,
            "manual-payment-301-2026-03-25",
        )

    assert manual_summary["changed"] is True
    assert manual_summary["settledPayments"] == 1
    assert len(manual_state["expenseEntries"]) == 1
    assert manual_state["expenseEntries"][0]["date"] == "2026-03-10"
    assert manual_state["payments"] == []


def test_manual_settlement_is_idempotent_for_same_target():
    state = base_state()
    state["payments"] = [
        {
            "id": 401,
            "name": "Abonament",
            "amount": 80.0,
            "date": "2026-03-11",
            "frequency": "monthly",
            "type": "expense",
            "months": [],
            "paidDates": [],
        }
    ]

    with patch("server.app_now", return_value=datetime(2026, 3, 10, 11, 0, tzinfo=timezone.utc)):
        first_state, first_summary, _ = server.apply_server_settlement(
            state,
            "manual-payment-401-2026-03-11",
        )

    assert first_summary["changed"] is True
    assert first_summary["settledPayments"] == 1
    assert len(first_state["expenseEntries"]) == 1

    with patch("server.app_now", return_value=datetime(2026, 3, 10, 11, 5, tzinfo=timezone.utc)):
        second_state, second_summary, _ = server.apply_server_settlement(
            first_state,
            "manual-payment-401-2026-03-11",
        )

    assert second_summary["changed"] is False
    assert second_summary["settledPayments"] == 0
    assert len(second_state["expenseEntries"]) == 1


def test_manual_wrong_occurrence_does_not_change_state():
    state = base_state()
    state["payments"] = [
        {
            "id": 501,
            "name": "Rachunek",
            "amount": 210.0,
            "date": "2026-03-20",
            "frequency": "monthly",
            "type": "expense",
            "months": [],
            "paidDates": [],
        }
    ]

    with patch("server.app_now", return_value=datetime(2026, 3, 10, 10, 0, tzinfo=timezone.utc)):
        manual_state, manual_summary, _ = server.apply_server_settlement(
            state,
            "manual-payment-501-2026-03-19",
        )

    assert manual_summary["changed"] is False
    assert manual_summary["settledPayments"] == 0
    assert manual_state["expenseEntries"] == []
    assert manual_state["payments"][0]["paidDates"] == []


if __name__ == "__main__":
    test_manual_payment_before_due_books_today_and_blocks_auto_duplicate()
    test_manual_income_before_due_books_today_and_blocks_auto_duplicate()
    test_manual_once_payment_is_removed_after_booking()
    test_manual_settlement_is_idempotent_for_same_target()
    test_manual_wrong_occurrence_does_not_change_state()
    print("manual settlement tests: OK")
