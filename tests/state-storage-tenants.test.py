from copy import deepcopy
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


def build_state():
    payload = deepcopy(server.DEFAULT_STATE)
    payload["balance"] = 2500.0
    payload["tenantProfiles"] = [
        {
            "id": 1,
            "isActive": True,
            "name": "Kowalski",
            "amount": 1800.0,
            "dueDay": 10,
        }
    ]
    payload["tenantPaymentHistory"] = [
        {
            "id": 701,
            "tenantId": 1,
            "month": "2026-03",
            "amount": 1800.0,
            "dueDate": "2026-03-10",
            "paid": True,
            "paidAt": "2026-03-09",
            "incomeEntryId": 801,
        }
    ]
    return payload


def test_write_and_read_preserves_tenant_state():
    original_db_path = server.DB_PATH

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            server.DB_PATH = Path(temp_dir) / "tenant-test.db"
            server.init_db()

            written = server.write_state(build_state())
            read_back = server.read_state()

            assert written["tenantProfiles"][0]["name"] == "Kowalski"
            assert read_back["tenantProfiles"][0]["name"] == "Kowalski"
            assert read_back["tenantPaymentHistory"][0]["incomeEntryId"] == 801
    finally:
        server.DB_PATH = original_db_path


if __name__ == "__main__":
    test_write_and_read_preserves_tenant_state()
    print("tenant state storage tests: OK")
