from copy import deepcopy
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


def with_temp_db(callback):
    original_db_path = server.DB_PATH
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            server.DB_PATH = Path(temp_dir) / "rentals-test.db"
            server.init_db()
            callback()
    finally:
        server.DB_PATH = original_db_path


def seed_state():
    payload = deepcopy(server.DEFAULT_STATE)
    payload["tenantProfiles"] = [
        {
            "id": 1,
            "isActive": True,
            "name": "Kowalski",
            "amount": 1800.0,
            "dueDay": 10,
        },
        {
            "id": 2,
            "isActive": True,
            "name": "Nowak",
            "amount": 2200.0,
            "dueDay": 12,
        },
    ]
    payload["tenantPaymentHistory"] = [
        {
            "id": 301,
            "tenantId": 1,
            "month": "2026-04",
            "amount": 1800.0,
            "dueDate": "2026-04-10",
            "paid": True,
            "paidAt": "2026-04-08",
            "incomeEntryId": 901,
        }
    ]
    server.write_state(payload)


def test_rental_schema_tables_are_created():
    def run():
        conn = server.sqlite3.connect(server.DB_PATH)
        try:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
            }
        finally:
            conn.close()

        assert "rental_properties" in tables
        assert "rental_monthly_charges" in tables
        assert "rental_bank_imports" in tables
        assert "rental_audit_events" in tables

    with_temp_db(run)


def test_rental_overview_uses_existing_tenant_state():
    def run():
        seed_state()
        overview = server.build_rental_overview("2026-04", "2026")

        assert overview["labels"]["managementMarek"] == "Zarządzanie Marek"
        assert overview["labels"]["ownerIncome"] == "Mój przychód"
        assert overview["monthSummary"]["activeTenants"] == 2
        assert overview["monthSummary"]["paidTenants"] == 1
        assert overview["monthSummary"]["expectedTotal"] == 4000.0
        assert overview["monthSummary"]["paidTotal"] == 1800.0
        assert len(overview["yearMonths"]) == 12

    with_temp_db(run)


def test_bank_import_preview_matches_csv_transaction_to_tenant():
    def run():
        seed_state()
        preview = server.preview_bank_statement_import(
            {
                "fileName": "wyciag.csv",
                "content": "data;kwota;tytuł;kontrahent\n2026-04-08;1800,00;czynsz Kowalski;Jan Kowalski\n",
            }
        )

        assert preview["transactionCount"] == 1
        suggestion = preview["suggestions"][0]
        assert suggestion["tenantName"] == "Kowalski"
        assert suggestion["confidence"] >= 0.75
        assert suggestion["requiresReview"] is False

    with_temp_db(run)


if __name__ == "__main__":
    test_rental_schema_tables_are_created()
    test_rental_overview_uses_existing_tenant_state()
    test_bank_import_preview_matches_csv_transaction_to_tenant()
    print("rentals tests: OK")
