#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import threading
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_STATE = {
    "pin": "1234",
    "balance": 3420.0,
    "payments": [
        {
            "id": 100001,
            "name": "Czynsz",
            "amount": 1500.0,
            "date": "2026-02-10",
            "frequency": "monthly",
            "months": [],
            "type": "expense",
            "paidDates": ["2026-02-10"],
        },
        {
            "id": 100002,
            "name": "Internet",
            "amount": 79.99,
            "date": "2026-02-18",
            "frequency": "monthly",
            "months": [],
            "type": "expense",
            "paidDates": [],
        },
    ],
    "incomes": [
        {
            "id": 200001,
            "name": "Wypłata",
            "amount": 5200.0,
            "date": "2026-02-01",
            "frequency": "monthly",
            "type": "income",
        }
    ],
    "expenseEntries": [
        {
            "id": 300001,
            "amount": 1500.0,
            "category": "zaplanowane płatności",
            "date": "2026-02-10",
            "source": "planned-payment",
            "name": "Czynsz",
            "icon": "📅",
        },
        {
            "id": 300002,
            "amount": 124.8,
            "category": "jedzenie",
            "date": "2026-02-12",
            "source": "balance-update",
            "name": "",
            "icon": "🍽️",
        },
        {
            "id": 300003,
            "amount": 95.0,
            "category": "paliwo",
            "date": "2026-02-13",
            "source": "balance-update",
            "name": "",
            "icon": "⛽",
        },
        {
            "id": 300004,
            "amount": 62.5,
            "category": "suplementy",
            "date": "2026-01-23",
            "source": "balance-update",
            "name": "",
            "icon": "💪",
        },
    ],
    "incomeEntries": [
        {
            "id": 400001,
            "amount": 700.0,
            "category": "premia",
            "date": "2026-02-05",
            "source": "balance-update",
            "name": "",
            "icon": "🎁",
        },
        {
            "id": 400002,
            "amount": 300.0,
            "category": "rodzice",
            "date": "2026-02-09",
            "source": "balance-update",
            "name": "",
            "icon": "👨‍👩‍👧",
        },
        {
            "id": 400003,
            "amount": 220.0,
            "category": "inne",
            "date": "2026-01-20",
            "source": "balance-update",
            "name": "Sprzedaż rzeczy",
            "icon": "✨",
        },
    ],
    "expenseCategoryTotals": {
        "zaplanowane płatności": 1500.0,
        "jedzenie": 124.8,
        "paliwo": 95.0,
        "suplementy": 62.5,
    },
    "incomeCategoryTotals": {
        "premia": 700.0,
        "rodzice": 300.0,
        "inne": 220.0,
    },
}

DB_LOCK = threading.Lock()
DB_PATH = Path("budget.db")


def sanitize_entries(raw_entries, default_category):
    if not isinstance(raw_entries, list):
        raw_entries = []

    cleaned_entries = []
    for item in raw_entries:
        if not isinstance(item, dict):
            continue

        try:
            amount = round(float(item.get("amount", 0)), 2)
        except (TypeError, ValueError):
            amount = 0.0

        category = str(item.get("category") or default_category).strip()
        if not category:
            category = default_category

        entry_date = str(item.get("date") or "").strip()
        if not entry_date:
            entry_date = date.today().isoformat()

        try:
            entry_id = int(item.get("id", 0))
        except (TypeError, ValueError):
            entry_id = 0

        cleaned_entries.append(
            {
                "id": entry_id,
                "amount": amount,
                "category": category,
                "date": entry_date,
                "source": str(item.get("source") or "balance-update"),
                "name": str(item.get("name") or ""),
                "icon": str(item.get("icon") or ""),
            }
        )

    return cleaned_entries


def sanitize_totals(raw_totals):
    if not isinstance(raw_totals, dict):
        raw_totals = {}

    cleaned_totals = {}
    for key, value in raw_totals.items():
        category = str(key).strip()
        if not category:
            continue
        try:
            amount = round(float(value), 2)
        except (TypeError, ValueError):
            amount = 0.0
        cleaned_totals[category] = amount

    return cleaned_totals


def parse_json_column(value, fallback):
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed = fallback
    return parsed


def sanitize_state(raw_state):
    if not isinstance(raw_state, dict):
        raw_state = {}

    pin = str(raw_state.get("pin", DEFAULT_STATE["pin"]))
    if not pin:
        pin = DEFAULT_STATE["pin"]

    try:
        balance = float(raw_state.get("balance", DEFAULT_STATE["balance"]))
    except (TypeError, ValueError):
        balance = DEFAULT_STATE["balance"]

    payments = raw_state.get("payments", [])
    incomes = raw_state.get("incomes", [])
    expense_entries = raw_state.get("expenseEntries", [])
    income_entries = raw_state.get("incomeEntries", [])
    expense_totals = raw_state.get("expenseCategoryTotals", {})
    income_totals = raw_state.get("incomeCategoryTotals", {})

    if not isinstance(payments, list):
        payments = []
    if not isinstance(incomes, list):
        incomes = []

    return {
        "pin": pin,
        "balance": balance,
        "payments": payments,
        "incomes": incomes,
        "expenseEntries": sanitize_entries(expense_entries, "inne"),
        "incomeEntries": sanitize_entries(income_entries, "inne"),
        "expenseCategoryTotals": sanitize_totals(expense_totals),
        "incomeCategoryTotals": sanitize_totals(income_totals),
    }


def init_db():
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    pin TEXT NOT NULL,
                    balance REAL NOT NULL,
                    payments TEXT NOT NULL,
                    incomes TEXT NOT NULL,
                    expense_entries TEXT NOT NULL DEFAULT '[]',
                    income_entries TEXT NOT NULL DEFAULT '[]',
                    expense_totals TEXT NOT NULL DEFAULT '{}',
                    income_totals TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

            existing_columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(app_state)").fetchall()
            }
            if "expense_entries" not in existing_columns:
                conn.execute(
                    "ALTER TABLE app_state ADD COLUMN expense_entries TEXT NOT NULL DEFAULT '[]'"
                )
            if "income_entries" not in existing_columns:
                conn.execute(
                    "ALTER TABLE app_state ADD COLUMN income_entries TEXT NOT NULL DEFAULT '[]'"
                )
            if "expense_totals" not in existing_columns:
                conn.execute(
                    "ALTER TABLE app_state ADD COLUMN expense_totals TEXT NOT NULL DEFAULT '{}'"
                )
            if "income_totals" not in existing_columns:
                conn.execute(
                    "ALTER TABLE app_state ADD COLUMN income_totals TEXT NOT NULL DEFAULT '{}'"
                )

            conn.execute("UPDATE app_state SET expense_entries = '[]' WHERE expense_entries IS NULL")
            conn.execute("UPDATE app_state SET income_entries = '[]' WHERE income_entries IS NULL")
            conn.execute("UPDATE app_state SET expense_totals = '{}' WHERE expense_totals IS NULL")
            conn.execute("UPDATE app_state SET income_totals = '{}' WHERE income_totals IS NULL")

            row = conn.execute("SELECT id FROM app_state WHERE id = 1").fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO app_state (
                        id, pin, balance, payments, incomes,
                        expense_entries, income_entries, expense_totals, income_totals
                    )
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        DEFAULT_STATE["pin"],
                        DEFAULT_STATE["balance"],
                        json.dumps(DEFAULT_STATE["payments"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["incomes"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["expenseEntries"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["incomeEntries"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["expenseCategoryTotals"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["incomeCategoryTotals"], ensure_ascii=False),
                    ),
                )
            conn.commit()
        finally:
            conn.close()


def read_state():
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            row = conn.execute(
                """
                SELECT
                    pin,
                    balance,
                    payments,
                    incomes,
                    expense_entries,
                    income_entries,
                    expense_totals,
                    income_totals
                FROM app_state
                WHERE id = 1
                """
            ).fetchone()
        finally:
            conn.close()

    if row is None:
        return dict(DEFAULT_STATE)

    payments = parse_json_column(row[2], [])
    incomes = parse_json_column(row[3], [])
    expense_entries = parse_json_column(row[4], [])
    income_entries = parse_json_column(row[5], [])
    expense_totals = parse_json_column(row[6], {})
    income_totals = parse_json_column(row[7], {})

    return sanitize_state(
        {
            "pin": row[0],
            "balance": row[1],
            "payments": payments,
            "incomes": incomes,
            "expenseEntries": expense_entries,
            "incomeEntries": income_entries,
            "expenseCategoryTotals": expense_totals,
            "incomeCategoryTotals": income_totals,
        }
    )


def write_state(state):
    clean_state = sanitize_state(state)
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            cursor = conn.execute(
                """
                UPDATE app_state
                SET
                    pin = ?,
                    balance = ?,
                    payments = ?,
                    incomes = ?,
                    expense_entries = ?,
                    income_entries = ?,
                    expense_totals = ?,
                    income_totals = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                """,
                (
                    clean_state["pin"],
                    clean_state["balance"],
                    json.dumps(clean_state["payments"], ensure_ascii=False),
                    json.dumps(clean_state["incomes"], ensure_ascii=False),
                    json.dumps(clean_state["expenseEntries"], ensure_ascii=False),
                    json.dumps(clean_state["incomeEntries"], ensure_ascii=False),
                    json.dumps(clean_state["expenseCategoryTotals"], ensure_ascii=False),
                    json.dumps(clean_state["incomeCategoryTotals"], ensure_ascii=False),
                ),
            )
            if cursor.rowcount == 0:
                conn.execute(
                    """
                    INSERT INTO app_state (
                        id, pin, balance, payments, incomes,
                        expense_entries, income_entries, expense_totals, income_totals
                    )
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        clean_state["pin"],
                        clean_state["balance"],
                        json.dumps(clean_state["payments"], ensure_ascii=False),
                        json.dumps(clean_state["incomes"], ensure_ascii=False),
                        json.dumps(clean_state["expenseEntries"], ensure_ascii=False),
                        json.dumps(clean_state["incomeEntries"], ensure_ascii=False),
                        json.dumps(clean_state["expenseCategoryTotals"], ensure_ascii=False),
                        json.dumps(clean_state["incomeCategoryTotals"], ensure_ascii=False),
                    ),
                )
            conn.commit()
        finally:
            conn.close()

    return clean_state


class BudgetRequestHandler(SimpleHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_state_get(self):
        state = read_state()
        self._send_json(200, state)

    def _handle_state_put(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        saved = write_state(payload)
        self._send_json(200, {"ok": True, "state": saved})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._handle_state_get()
            return

        if parsed.path == "/":
            self.path = "/budget-app.html"

        super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._handle_state_put()
            return

        self.send_error(404, "Not Found")


def main():
    default_host = os.getenv("HOST", "0.0.0.0")
    try:
        default_port = int(os.getenv("PORT", "8080"))
    except ValueError:
        default_port = 8080
    default_db = os.getenv("DB_PATH", "budget.db")

    parser = argparse.ArgumentParser(description="Budget app local server with SQLite storage")
    parser.add_argument("--host", default=default_host, help=f"Host to bind (default: {default_host})")
    parser.add_argument("--port", type=int, default=default_port, help=f"Port to bind (default: {default_port})")
    parser.add_argument("--db", default=default_db, help=f"SQLite database path (default: {default_db})")
    args = parser.parse_args()

    global DB_PATH
    DB_PATH = Path(args.db)
    if DB_PATH.parent and str(DB_PATH.parent) not in ("", "."):
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    init_db()

    server = ThreadingHTTPServer((args.host, args.port), BudgetRequestHandler)
    print(f"Server started: http://{args.host}:{args.port}")
    print(f"Database: {DB_PATH.resolve()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
