#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

import server


def build_empty_state(pin):
    return {
        "pin": str(pin or server.DEFAULT_STATE["pin"]),
        "balance": 0.0,
        "payments": [],
        "incomes": [],
        "expenseEntries": [],
        "incomeEntries": [],
        "expenseCategoryTotals": {},
        "incomeCategoryTotals": {},
    }


def main():
    parser = argparse.ArgumentParser(
        description="One-time reset of budget data while keeping current PIN."
    )
    parser.add_argument(
        "--db",
        default=os.getenv("DB_PATH", "budget.db"),
        help="SQLite database path (default: DB_PATH env or budget.db)",
    )
    args = parser.parse_args()

    server.DB_PATH = Path(args.db)
    if server.DB_PATH.parent and str(server.DB_PATH.parent) not in ("", "."):
        server.DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    server.init_db()
    current_state = server.read_state()
    current_pin = current_state.get("pin", server.DEFAULT_STATE["pin"])

    reset_state = build_empty_state(current_pin)
    saved = server.write_state(reset_state)

    print("Reset completed.")
    print(f"DB: {server.DB_PATH.resolve()}")
    print(f"PIN kept: {saved.get('pin')}")
    print(f"Balance: {saved.get('balance')}")
    print(f"Payments: {len(saved.get('payments', []))}")
    print(f"Incomes: {len(saved.get('incomes', []))}")
    print(f"Expense entries: {len(saved.get('expenseEntries', []))}")
    print(f"Income entries: {len(saved.get('incomeEntries', []))}")


if __name__ == "__main__":
    main()
