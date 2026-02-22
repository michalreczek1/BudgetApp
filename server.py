#!/usr/bin/env python3
import argparse
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

mimetypes.add_type("application/manifest+json", ".webmanifest")


def env_flag(name, default=False):
    raw_value = os.getenv(name)
    if raw_value is None:
        return bool(default)
    return str(raw_value).strip().lower() in ("1", "true", "yes", "on")


def env_int(name, default, minimum):
    raw_value = os.getenv(name)
    if raw_value is None:
        return max(minimum, int(default))
    try:
        parsed = int(str(raw_value).strip())
    except (TypeError, ValueError):
        parsed = int(default)
    return max(minimum, parsed)


MAX_TEXT_LENGTH = 120
MAX_ICON_LENGTH = 16
DEPRECATED_PIN_VALUE = "__deprecated__"
APP_TIMEZONE_NAME = str(os.getenv("APP_TIMEZONE", "Europe/Warsaw")).strip() or "Europe/Warsaw"
VALID_PAYMENT_FREQUENCIES = {"once", "monthly", "selected"}
VALID_INCOME_FREQUENCIES = {"once", "monthly"}
DEFAULT_STATE = {
    "pin": DEPRECATED_PIN_VALUE,
    "version": 1,
    "balance": 0.0,
    "payments": [],
    "incomes": [],
    "expenseEntries": [],
    "incomeEntries": [],
    "expenseCategoryTotals": {},
    "incomeCategoryTotals": {},
}

DB_LOCK = threading.Lock()
DB_PATH = Path("budget.db")
SESSION_COOKIE_NAME = "budget_session"
SESSION_TTL_SECONDS = 24 * 60 * 60
LOCKOUT_WINDOW_SECONDS = 15 * 60
LOCKOUT_DURATION_SECONDS = 15 * 60
LOCKOUT_THRESHOLD = 5
PIN_SCRYPT_PARAMS = {
    "n": 2**14,
    "r": 8,
    "p": 1,
    "dklen": 64,
}
BACKUP_INTERVAL_SECONDS = env_int("BACKUP_INTERVAL_SECONDS", 24 * 60 * 60, 300)
BACKUP_RETENTION_COUNT = env_int("BACKUP_RETENTION_COUNT", 14, 1)
MAX_BACKUP_UPLOAD_BYTES = env_int("MAX_BACKUP_UPLOAD_BYTES", 25 * 1024 * 1024, 1024 * 1024)
STATIC_FILE_WHITELIST = {
    "/": "budget-app.html",
    "/budget-app.html": "budget-app.html",
    "/style.css": "style.css",
    "/date-utils.js": "date-utils.js",
    "/app.js": "app.js",
    "/js/formatters.js": "js/formatters.js",
    "/js/toast.js": "js/toast.js",
    "/js/pwa.js": "js/pwa.js",
    "/js/api.js": "js/api.js",
    "/js/admin.js": "js/admin.js",
    "/js/render.js": "js/render.js",
    "/js/analysis.js": "js/analysis.js",
    "/js/ui-modals.js": "js/ui-modals.js",
    "/js/scheduling.js": "js/scheduling.js",
    "/js/actions.js": "js/actions.js",
    "/service-worker.js": "service-worker.js",
    "/manifest.webmanifest": "manifest.webmanifest",
    "/newicon.jpg": "newicon.jpg",
    "/icon-192.png": "icon-192.png",
    "/icon-512.png": "icon-512.png",
}
STATE_REQUIRED_KEYS = {
    "version",
    "balance",
    "payments",
    "incomes",
    "expenseEntries",
    "incomeEntries",
    "expenseCategoryTotals",
    "incomeCategoryTotals",
}
SETTLEMENT_STATUS = {
    "lastRunAt": None,
    "timezone": APP_TIMEZONE_NAME,
    "changed": False,
    "summary": {
        "settledPayments": 0,
        "settledIncomes": 0,
        "balanceDelta": 0.0,
    },
}


class StateConflictError(Exception):
    def __init__(self, current_version):
        super().__init__("State version conflict")
        self.current_version = int(current_version or 1)


def sanitize_entries(raw_entries, default_category):
    if not isinstance(raw_entries, list):
        raw_entries = []

    cleaned_entries = []
    for item in raw_entries:
        if not isinstance(item, dict):
            continue

        amount = abs(round_currency(item.get("amount", 0)))

        category = sanitize_text(
            item.get("category", default_category),
            allow_empty=False,
            default=default_category,
        )
        if not category:
            category = default_category

        entry_date = str(item.get("date") or "").strip()
        if not is_iso_date(entry_date):
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
                "source": sanitize_text(item.get("source", "balance-update"), max_length=64, default="balance-update"),
                "name": sanitize_text(item.get("name", ""), max_length=MAX_TEXT_LENGTH, default=""),
                "icon": sanitize_text(item.get("icon", ""), max_length=MAX_ICON_LENGTH, default=""),
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
        if amount < 0:
            amount = 0.0
        cleaned_totals[category] = amount

    return cleaned_totals


def sanitize_payment(payment):
    if not isinstance(payment, dict):
        payment = {}

    try:
        payment_id = int(payment.get("id", 0))
    except (TypeError, ValueError):
        payment_id = 0

    frequency = str(payment.get("frequency", "once")).strip().lower()
    if frequency not in VALID_PAYMENT_FREQUENCIES:
        frequency = "once"

    base_date = str(payment.get("date", "")).strip()
    if not is_iso_date(base_date):
        base_date = date.today().isoformat()

    months = normalize_months(payment.get("months", [])) if frequency == "selected" else []

    return {
        "id": payment_id,
        "name": sanitize_text(payment.get("name", ""), max_length=MAX_TEXT_LENGTH, allow_empty=False, default="Bez nazwy"),
        "amount": abs(round_currency(payment.get("amount", 0))),
        "date": base_date,
        "frequency": frequency,
        "months": months,
        "paidDates": normalize_date_list(payment.get("paidDates", [])),
        "type": "expense",
    }


def sanitize_income(income):
    if not isinstance(income, dict):
        income = {}

    try:
        income_id = int(income.get("id", 0))
    except (TypeError, ValueError):
        income_id = 0

    frequency = str(income.get("frequency", "once")).strip().lower()
    if frequency not in VALID_INCOME_FREQUENCIES:
        frequency = "once"

    base_date = str(income.get("date", "")).strip()
    if not is_iso_date(base_date):
        base_date = date.today().isoformat()

    return {
        "id": income_id,
        "name": sanitize_text(income.get("name", ""), max_length=MAX_TEXT_LENGTH, allow_empty=False, default="Bez nazwy"),
        "amount": abs(round_currency(income.get("amount", 0))),
        "date": base_date,
        "frequency": frequency,
        "receivedDates": normalize_date_list(income.get("receivedDates", [])),
        "type": "income",
    }


def parse_json_column(value, fallback):
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed = fallback
    return parsed


def utcnow():
    return datetime.now(timezone.utc)


def isoformat_utc(value):
    return value.astimezone(timezone.utc).isoformat()


def parse_iso_datetime(raw_value):
    if not raw_value:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def get_app_timezone():
    try:
        return ZoneInfo(APP_TIMEZONE_NAME)
    except Exception:
        try:
            return ZoneInfo("Europe/Warsaw")
        except Exception:
            return timezone.utc


def app_now():
    return datetime.now(get_app_timezone())


def round_currency(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = 0.0
    if not math.isfinite(parsed):
        parsed = 0.0
    return round(parsed, 2)


def is_finite_number(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(parsed)


def sanitize_text(value, *, max_length=MAX_TEXT_LENGTH, default="", allow_empty=True):
    text = str(value or "").strip()
    if not text and not allow_empty:
        text = default
    if not text:
        return default if default and not allow_empty else ""
    return text[:max_length]


def parse_iso_date(raw_value):
    raw = str(raw_value or "").strip()
    if not ISO_DATE_RE.match(raw):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def is_iso_date(raw_value):
    return parse_iso_date(raw_value) is not None


def normalize_date_list(raw_dates):
    if not isinstance(raw_dates, list):
        return []
    normalized = []
    seen = set()
    for raw_date in raw_dates:
        parsed = parse_iso_date(raw_date)
        if not parsed:
            continue
        formatted = parsed.isoformat()
        if formatted in seen:
            continue
        seen.add(formatted)
        normalized.append(formatted)
    normalized.sort()
    return normalized


def normalize_months(raw_months):
    if not isinstance(raw_months, list):
        return []
    normalized = sorted(
        {
            int(month)
            for month in raw_months
            if isinstance(month, (int, float, str)) and str(month).strip().isdigit()
            and 1 <= int(month) <= 12
        }
    )
    return normalized


def build_category_totals(entries):
    totals = {}
    for entry in entries:
        category = sanitize_text(entry.get("category", ""), allow_empty=False, default="inne")
        totals[category] = round_currency(totals.get(category, 0) + round_currency(entry.get("amount", 0)))
    return totals


def add_validation_error(errors, field, message):
    errors.append({"field": field, "message": message})


def validate_state_payload(payload):
    errors = []
    if not isinstance(payload, dict):
        add_validation_error(errors, "payload", "Payload must be a JSON object")
        return errors

    provided_keys = set(payload.keys())
    missing_keys = sorted(STATE_REQUIRED_KEYS - provided_keys)
    extra_keys = sorted(provided_keys - STATE_REQUIRED_KEYS)
    for key in missing_keys:
        add_validation_error(errors, key, "Missing required field")
    for key in extra_keys:
        add_validation_error(errors, key, "Unknown field")

    version_value = payload.get("version")
    if isinstance(version_value, bool) or not isinstance(version_value, int) or version_value < 1:
        add_validation_error(errors, "version", "Version must be a positive integer")

    balance_value = payload.get("balance")
    if not is_finite_number(balance_value):
        add_validation_error(errors, "balance", "Balance must be a finite number")

    def validate_schedule_items(field_name, items, entry_kind):
        if not isinstance(items, list):
            add_validation_error(errors, field_name, "Must be an array")
            return

        seen_ids = set()
        for idx, item in enumerate(items):
            prefix = f"{field_name}[{idx}]"
            if not isinstance(item, dict):
                add_validation_error(errors, prefix, "Item must be an object")
                continue

            allowed_keys = {"id", "name", "amount", "date", "frequency", "type"}
            if entry_kind == "payment":
                allowed_keys.update({"months", "paidDates"})
            else:
                allowed_keys.update({"receivedDates"})
            unknown = sorted(set(item.keys()) - allowed_keys)
            for key in unknown:
                add_validation_error(errors, f"{prefix}.{key}", "Unknown field")

            item_id = item.get("id")
            if isinstance(item_id, bool) or not isinstance(item_id, int) or item_id <= 0:
                add_validation_error(errors, f"{prefix}.id", "ID must be a positive integer")
            elif item_id in seen_ids:
                add_validation_error(errors, f"{prefix}.id", "Duplicate ID")
            else:
                seen_ids.add(item_id)

            name_value = sanitize_text(item.get("name", ""), allow_empty=False, default="")
            if not name_value:
                add_validation_error(errors, f"{prefix}.name", "Name is required")
            if len(str(item.get("name", "")).strip()) > MAX_TEXT_LENGTH:
                add_validation_error(errors, f"{prefix}.name", f"Name max length is {MAX_TEXT_LENGTH}")

            amount_value = item.get("amount")
            if not is_finite_number(amount_value) or float(amount_value) <= 0:
                add_validation_error(errors, f"{prefix}.amount", "Amount must be > 0")

            if not is_iso_date(item.get("date")):
                add_validation_error(errors, f"{prefix}.date", "Date must be in YYYY-MM-DD format")

            frequency = str(item.get("frequency", "")).strip().lower()
            valid_freq = VALID_PAYMENT_FREQUENCIES if entry_kind == "payment" else VALID_INCOME_FREQUENCIES
            if frequency not in valid_freq:
                add_validation_error(errors, f"{prefix}.frequency", "Invalid frequency")

            if entry_kind == "payment":
                months = item.get("months", [])
                if frequency == "selected":
                    normalized_months = normalize_months(months)
                    if not normalized_months:
                        add_validation_error(errors, f"{prefix}.months", "Selected frequency requires at least one month")
                    if len(normalized_months) != len(months):
                        add_validation_error(errors, f"{prefix}.months", "Months must contain unique values from 1 to 12")
                elif months not in ([], None):
                    if isinstance(months, list) and len(months) > 0:
                        add_validation_error(errors, f"{prefix}.months", "Months are allowed only for selected frequency")

                paid_dates = item.get("paidDates", [])
                if paid_dates not in (None, []) and not isinstance(paid_dates, list):
                    add_validation_error(errors, f"{prefix}.paidDates", "paidDates must be an array")
                if isinstance(paid_dates, list):
                    normalized_paid = normalize_date_list(paid_dates)
                    if any(not is_iso_date(raw_date) for raw_date in paid_dates):
                        add_validation_error(errors, f"{prefix}.paidDates", "paidDates must contain valid YYYY-MM-DD dates")
                    if len(normalized_paid) != len(paid_dates):
                        add_validation_error(errors, f"{prefix}.paidDates", "paidDates must contain unique dates")
            else:
                received_dates = item.get("receivedDates", [])
                if received_dates not in (None, []) and not isinstance(received_dates, list):
                    add_validation_error(errors, f"{prefix}.receivedDates", "receivedDates must be an array")
                if isinstance(received_dates, list):
                    normalized_received = normalize_date_list(received_dates)
                    if any(not is_iso_date(raw_date) for raw_date in received_dates):
                        add_validation_error(errors, f"{prefix}.receivedDates", "receivedDates must contain valid YYYY-MM-DD dates")
                    if len(normalized_received) != len(received_dates):
                        add_validation_error(errors, f"{prefix}.receivedDates", "receivedDates must contain unique dates")

    def validate_history_entries(field_name, entries):
        if not isinstance(entries, list):
            add_validation_error(errors, field_name, "Must be an array")
            return

        seen_ids = set()
        for idx, entry in enumerate(entries):
            prefix = f"{field_name}[{idx}]"
            if not isinstance(entry, dict):
                add_validation_error(errors, prefix, "Entry must be an object")
                continue

            allowed_keys = {"id", "amount", "category", "date", "source", "name", "icon"}
            unknown = sorted(set(entry.keys()) - allowed_keys)
            for key in unknown:
                add_validation_error(errors, f"{prefix}.{key}", "Unknown field")

            entry_id = entry.get("id")
            if isinstance(entry_id, bool) or not isinstance(entry_id, int) or entry_id <= 0:
                add_validation_error(errors, f"{prefix}.id", "ID must be a positive integer")
            elif entry_id in seen_ids:
                add_validation_error(errors, f"{prefix}.id", "Duplicate ID")
            else:
                seen_ids.add(entry_id)

            amount_value = entry.get("amount")
            if not is_finite_number(amount_value) or float(amount_value) <= 0:
                add_validation_error(errors, f"{prefix}.amount", "Amount must be > 0")

            category_text = str(entry.get("category", "")).strip()
            if not category_text:
                add_validation_error(errors, f"{prefix}.category", "Category is required")
            if len(category_text) > MAX_TEXT_LENGTH:
                add_validation_error(errors, f"{prefix}.category", f"Category max length is {MAX_TEXT_LENGTH}")

            if not is_iso_date(entry.get("date")):
                add_validation_error(errors, f"{prefix}.date", "Date must be in YYYY-MM-DD format")

            name_text = str(entry.get("name", "")).strip()
            if len(name_text) > MAX_TEXT_LENGTH:
                add_validation_error(errors, f"{prefix}.name", f"Name max length is {MAX_TEXT_LENGTH}")

            icon_text = str(entry.get("icon", "")).strip()
            if len(icon_text) > MAX_ICON_LENGTH:
                add_validation_error(errors, f"{prefix}.icon", f"Icon max length is {MAX_ICON_LENGTH}")

    def validate_totals(field_name, totals):
        if not isinstance(totals, dict):
            add_validation_error(errors, field_name, "Must be an object")
            return

        for key, value in totals.items():
            category = str(key).strip()
            if not category:
                add_validation_error(errors, field_name, "Category key cannot be empty")
                continue
            if len(category) > MAX_TEXT_LENGTH:
                add_validation_error(errors, f"{field_name}.{category}", f"Category key max length is {MAX_TEXT_LENGTH}")
            if not is_finite_number(value) or float(value) < 0:
                add_validation_error(errors, f"{field_name}.{category}", "Total must be a finite number >= 0")

    validate_schedule_items("payments", payload.get("payments"), "payment")
    validate_schedule_items("incomes", payload.get("incomes"), "income")
    validate_history_entries("expenseEntries", payload.get("expenseEntries"))
    validate_history_entries("incomeEntries", payload.get("incomeEntries"))
    validate_totals("expenseCategoryTotals", payload.get("expenseCategoryTotals"))
    validate_totals("incomeCategoryTotals", payload.get("incomeCategoryTotals"))
    return errors


def path_is_within(child_path, parent_path):
    try:
        child_path.resolve().relative_to(parent_path.resolve())
        return True
    except ValueError:
        return False


def is_mount_point(path_value):
    path_text = str(path_value)
    try:
        with open("/proc/mounts", "r", encoding="utf-8") as mounts_file:
            for line in mounts_file:
                parts = line.split()
                if len(parts) >= 2 and parts[1] == path_text:
                    return True
    except OSError:
        return False
    return False


def running_on_railway():
    return bool(str(os.getenv("RAILWAY_PROJECT_ID", "")).strip())


def get_required_persistent_mount():
    return Path(str(os.getenv("PERSISTENT_MOUNT_PATH", "/data")).strip() or "/data")


def storage_guard_enabled():
    if not running_on_railway():
        return False
    if env_flag("ALLOW_EPHEMERAL_DB", False):
        return False
    return env_flag("REQUIRE_PERSISTENT_STORAGE", True)


def enforce_storage_guard():
    if not storage_guard_enabled():
        return

    required_mount = get_required_persistent_mount().resolve()
    resolved_db = DB_PATH.resolve()

    if not path_is_within(resolved_db, required_mount):
        raise RuntimeError(
            "Unsafe DB_PATH on Railway. "
            f"DB_PATH={resolved_db} must be inside {required_mount}. "
            "Set DB_PATH under persistent mount or set ALLOW_EPHEMERAL_DB=1 to bypass."
        )

    if not is_mount_point(required_mount):
        raise RuntimeError(
            "Persistent volume is not mounted. "
            f"Expected mount at {required_mount}. "
            "Attach Railway volume before starting the app."
        )


def get_storage_status():
    required_mount = get_required_persistent_mount()
    resolved_db = DB_PATH.resolve()
    backup_dir = get_backup_dir().resolve()
    mount_resolved = required_mount.resolve()
    mounted = is_mount_point(mount_resolved)
    db_on_required_mount = path_is_within(resolved_db, mount_resolved)
    guard_on = storage_guard_enabled()
    safe = (not guard_on) or (mounted and db_on_required_mount)

    return {
        "railway": running_on_railway(),
        "guardEnabled": guard_on,
        "allowEphemeralDb": env_flag("ALLOW_EPHEMERAL_DB", False),
        "dbPath": str(resolved_db),
        "backupDir": str(backup_dir),
        "requiredMountPath": str(mount_resolved),
        "requiredMountPresent": mounted,
        "dbOnRequiredMount": db_on_required_mount,
        "safe": safe,
    }


def is_valid_pin(pin):
    return isinstance(pin, str) and len(pin) == 4 and pin.isdigit()


def normalize_pin(pin):
    if not isinstance(pin, str):
        pin = str(pin or "")
    pin = pin.strip()
    return pin


def hash_pin(pin, salt_hex, params=None):
    if params is None:
        params = PIN_SCRYPT_PARAMS
    pin_bytes = normalize_pin(pin).encode("utf-8")
    salt_bytes = bytes.fromhex(salt_hex)
    digest = hashlib.scrypt(
        pin_bytes,
        salt=salt_bytes,
        n=int(params["n"]),
        r=int(params["r"]),
        p=int(params["p"]),
        dklen=int(params["dklen"]),
    )
    return digest.hex()


def hash_session_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def client_ip_from_headers(headers, fallback_ip):
    xff = headers.get("X-Forwarded-For", "").strip()
    if xff:
        return xff.split(",")[0].strip()
    return str(fallback_ip or "")


def request_is_secure(headers):
    proto = headers.get("X-Forwarded-Proto", "").strip().lower()
    if proto == "https":
        return True
    forwarded = headers.get("Forwarded", "").lower()
    return "proto=https" in forwarded


def sanitize_state(raw_state):
    if not isinstance(raw_state, dict):
        raw_state = {}

    pin = DEPRECATED_PIN_VALUE

    try:
        version = int(raw_state.get("version", DEFAULT_STATE["version"]))
    except (TypeError, ValueError):
        version = DEFAULT_STATE["version"]
    if version < 1:
        version = 1

    balance = round_currency(raw_state.get("balance", DEFAULT_STATE["balance"]))

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

    cleaned_payments = [sanitize_payment(payment) for payment in payments]
    cleaned_incomes = [sanitize_income(income) for income in incomes]
    cleaned_expense_entries = sanitize_entries(expense_entries, "inne")
    cleaned_income_entries = sanitize_entries(income_entries, "inne")

    return {
        "pin": pin,
        "version": version,
        "balance": balance,
        "payments": cleaned_payments,
        "incomes": cleaned_incomes,
        "expenseEntries": cleaned_expense_entries,
        "incomeEntries": cleaned_income_entries,
        "expenseCategoryTotals": build_category_totals(cleaned_expense_entries),
        "incomeCategoryTotals": build_category_totals(cleaned_income_entries),
    }


def read_auth_meta():
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            row = conn.execute(
                "SELECT pin_hash, pin_salt, pin_params FROM auth_meta WHERE id = 1"
            ).fetchone()
        finally:
            conn.close()

    if row is None:
        return None

    params = parse_json_column(row[2], {})
    return {
        "pin_hash": str(row[0] or ""),
        "pin_salt": str(row[1] or ""),
        "pin_params": params if isinstance(params, dict) else dict(PIN_SCRYPT_PARAMS),
    }


def verify_pin(pin):
    meta = read_auth_meta()
    if not meta:
        return False

    try:
        computed = hash_pin(pin, meta["pin_salt"], meta["pin_params"])
    except Exception:
        return False

    return hmac.compare_digest(meta["pin_hash"], computed)


def update_auth_pin(new_pin):
    salt_hex = secrets.token_hex(16)
    pin_hash = hash_pin(new_pin, salt_hex, PIN_SCRYPT_PARAMS)
    params = json.dumps(PIN_SCRYPT_PARAMS, ensure_ascii=False)

    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            cursor = conn.execute(
                """
                UPDATE auth_meta
                SET pin_hash = ?, pin_salt = ?, pin_params = ?
                WHERE id = 1
                """,
                (pin_hash, salt_hex, params),
            )
            if cursor.rowcount == 0:
                conn.execute(
                    """
                    INSERT INTO auth_meta (id, pin_hash, pin_salt, pin_params)
                    VALUES (1, ?, ?, ?)
                    """,
                    (pin_hash, salt_hex, params),
                )
            conn.commit()
        finally:
            conn.close()


def reset_auth_failures():
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                """
                UPDATE auth_state
                SET failed_count = 0, window_start = NULL, locked_until = NULL
                WHERE id = 1
                """
            )
            conn.commit()
        finally:
            conn.close()


def get_lockout_status():
    now = utcnow()
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            row = conn.execute(
                "SELECT failed_count, window_start, locked_until FROM auth_state WHERE id = 1"
            ).fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO auth_state (id, failed_count, window_start, locked_until)
                    VALUES (1, 0, NULL, NULL)
                    """
                )
                conn.commit()
                return {"locked": False, "retry_after_sec": 0}

            locked_until = parse_iso_datetime(row[2])
            if locked_until and locked_until > now:
                retry_after = max(1, int((locked_until - now).total_seconds()))
                return {"locked": True, "retry_after_sec": retry_after}

            if locked_until and locked_until <= now:
                conn.execute(
                    """
                    UPDATE auth_state
                    SET failed_count = 0, window_start = NULL, locked_until = NULL
                    WHERE id = 1
                    """
                )
                conn.commit()
            return {"locked": False, "retry_after_sec": 0}
        finally:
            conn.close()


def register_failed_login_attempt():
    now = utcnow()
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            row = conn.execute(
                "SELECT failed_count, window_start, locked_until FROM auth_state WHERE id = 1"
            ).fetchone()
            if row is None:
                failed_count = 0
                window_start = None
                conn.execute(
                    """
                    INSERT INTO auth_state (id, failed_count, window_start, locked_until)
                    VALUES (1, 0, NULL, NULL)
                    """
                )
            else:
                failed_count = int(row[0] or 0)
                window_start = parse_iso_datetime(row[1])
                locked_until = parse_iso_datetime(row[2])
                if locked_until and locked_until > now:
                    retry_after = max(1, int((locked_until - now).total_seconds()))
                    return {"locked": True, "retry_after_sec": retry_after}

            if not window_start or (now - window_start).total_seconds() > LOCKOUT_WINDOW_SECONDS:
                failed_count = 1
                window_start = now
            else:
                failed_count += 1

            if failed_count >= LOCKOUT_THRESHOLD:
                locked_until = now + timedelta(seconds=LOCKOUT_DURATION_SECONDS)
                conn.execute(
                    """
                    UPDATE auth_state
                    SET failed_count = 0, window_start = NULL, locked_until = ?
                    WHERE id = 1
                    """,
                    (isoformat_utc(locked_until),),
                )
                conn.commit()
                return {
                    "locked": True,
                    "retry_after_sec": LOCKOUT_DURATION_SECONDS,
                }

            conn.execute(
                """
                UPDATE auth_state
                SET failed_count = ?, window_start = ?, locked_until = NULL
                WHERE id = 1
                """,
                (failed_count, isoformat_utc(window_start)),
            )
            conn.commit()
            return {"locked": False, "retry_after_sec": 0}
        finally:
            conn.close()


def create_session(ip_address, user_agent):
    token = secrets.token_urlsafe(32)
    token_hash = hash_session_token(token)
    now = utcnow()
    expires = now + timedelta(seconds=SESSION_TTL_SECONDS)

    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                "DELETE FROM auth_sessions WHERE expires_at <= ?",
                (isoformat_utc(now),),
            )
            conn.execute(
                """
                INSERT INTO auth_sessions (token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    token_hash,
                    isoformat_utc(now),
                    isoformat_utc(expires),
                    isoformat_utc(now),
                    ip_address,
                    user_agent,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    return token


def validate_session_token(raw_token):
    token = (raw_token or "").strip()
    if not token:
        return False

    token_hash = hash_session_token(token)
    now = utcnow()
    now_iso = isoformat_utc(now)

    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now_iso,))
            row = conn.execute(
                "SELECT id, expires_at FROM auth_sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            if row is None:
                conn.commit()
                return False

            expires_at = parse_iso_datetime(row[1])
            if not expires_at or expires_at <= now:
                conn.execute("DELETE FROM auth_sessions WHERE id = ?", (row[0],))
                conn.commit()
                return False

            conn.execute(
                "UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?",
                (now_iso, row[0]),
            )
            conn.commit()
            return True
        finally:
            conn.close()


def delete_session_token(raw_token):
    token = (raw_token or "").strip()
    if not token:
        return

    token_hash = hash_session_token(token)
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
            conn.commit()
        finally:
            conn.close()


def delete_all_sessions():
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("DELETE FROM auth_sessions")
            conn.commit()
        finally:
            conn.close()


def get_month_occurrence_date(base_date, year, month):
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    last_day = (next_month - timedelta(days=1)).day
    day = min(base_date.day, last_day)
    return date(year, month, day)


def get_payment_occurrence_for_month(payment, year, month):
    base_date = parse_iso_date(payment.get("date"))
    if not base_date:
        return None

    frequency = str(payment.get("frequency", "once")).strip().lower()
    if frequency == "once":
        if base_date.year == year and base_date.month == month:
            return base_date.isoformat()
        return None

    if frequency == "monthly":
        occurrence = get_month_occurrence_date(base_date, year, month)
        return occurrence.isoformat() if occurrence >= base_date else None

    if frequency == "selected":
        months = normalize_months(payment.get("months", []))
        if month not in months:
            return None
        occurrence = get_month_occurrence_date(base_date, year, month)
        return occurrence.isoformat() if occurrence >= base_date else None

    return None


def get_income_occurrence_for_month(income, year, month):
    base_date = parse_iso_date(income.get("date"))
    if not base_date:
        return None

    frequency = str(income.get("frequency", "once")).strip().lower()
    if frequency == "once":
        if base_date.year == year and base_date.month == month:
            return base_date.isoformat()
        return None

    if frequency == "monthly":
        occurrence = get_month_occurrence_date(base_date, year, month)
        return occurrence.isoformat() if occurrence >= base_date else None

    return None


def is_paid_occurrence(payment, occurrence):
    paid_dates = normalize_date_list(payment.get("paidDates", []))
    return occurrence in paid_dates


def is_received_occurrence(income, occurrence):
    received_dates = normalize_date_list(income.get("receivedDates", []))
    return occurrence in received_dates


def get_due_payment_occurrences(payment, today_value, include_today):
    due = []
    base_date = parse_iso_date(payment.get("date"))
    if not base_date:
        return due

    today_iso = today_value.isoformat()
    frequency = str(payment.get("frequency", "once")).strip().lower()

    if frequency == "once":
        occurrence = base_date.isoformat()
        is_due = occurrence < today_iso or (include_today and occurrence == today_iso)
        if is_due and not is_paid_occurrence(payment, occurrence):
            due.append(occurrence)
        return due

    month_cursor = date(base_date.year, base_date.month, 1)
    target_month = date(today_value.year, today_value.month, 1)
    while month_cursor <= target_month:
        occurrence = get_payment_occurrence_for_month(payment, month_cursor.year, month_cursor.month)
        if occurrence and not is_paid_occurrence(payment, occurrence):
            is_due = occurrence < today_iso or (include_today and occurrence == today_iso)
            if is_due:
                due.append(occurrence)
        if month_cursor.month == 12:
            month_cursor = date(month_cursor.year + 1, 1, 1)
        else:
            month_cursor = date(month_cursor.year, month_cursor.month + 1, 1)
    return due


def get_due_income_occurrences(income, today_value, include_today):
    due = []
    base_date = parse_iso_date(income.get("date"))
    if not base_date:
        return due

    today_iso = today_value.isoformat()
    frequency = str(income.get("frequency", "once")).strip().lower()

    if frequency == "once":
        occurrence = base_date.isoformat()
        is_due = occurrence < today_iso or (include_today and occurrence == today_iso)
        if is_due and not is_received_occurrence(income, occurrence):
            due.append(occurrence)
        return due

    month_cursor = date(base_date.year, base_date.month, 1)
    target_month = date(today_value.year, today_value.month, 1)
    while month_cursor <= target_month:
        occurrence = get_income_occurrence_for_month(income, month_cursor.year, month_cursor.month)
        if occurrence and not is_received_occurrence(income, occurrence):
            is_due = occurrence < today_iso or (include_today and occurrence == today_iso)
            if is_due:
                due.append(occurrence)
        if month_cursor.month == 12:
            month_cursor = date(month_cursor.year + 1, 1, 1)
        else:
            month_cursor = date(month_cursor.year, month_cursor.month + 1, 1)
    return due


MANUAL_SETTLEMENT_REASON_RE = re.compile(r"^manual-(payment|income)-(\d+)-(\d{4}-\d{2}-\d{2})$")


def parse_manual_settlement_reason(run_reason):
    reason_value = str(run_reason or "").strip().lower()
    match = MANUAL_SETTLEMENT_REASON_RE.match(reason_value)
    if not match:
        return None

    target_type, target_id_raw, occurrence = match.groups()
    if not is_iso_date(occurrence):
        return None

    try:
        target_id = int(target_id_raw)
    except (TypeError, ValueError):
        return None

    return {
        "type": target_type,
        "id": target_id,
        "occurrence": occurrence,
    }


def is_payment_occurrence_for_date(payment, occurrence):
    occurrence_date = parse_iso_date(occurrence)
    if not occurrence_date:
        return False

    expected_occurrence = get_payment_occurrence_for_month(payment, occurrence_date.year, occurrence_date.month)
    return expected_occurrence == occurrence


def is_income_occurrence_for_date(income, occurrence):
    occurrence_date = parse_iso_date(occurrence)
    if not occurrence_date:
        return False

    expected_occurrence = get_income_occurrence_for_month(income, occurrence_date.year, occurrence_date.month)
    return expected_occurrence == occurrence


def next_entry_id(expense_entries, income_entries):
    max_id = 0
    for entry in list(expense_entries) + list(income_entries):
        try:
            entry_id = int(entry.get("id", 0))
        except (TypeError, ValueError):
            entry_id = 0
        if entry_id > max_id:
            max_id = entry_id
    return max_id + 1


def apply_server_settlement(state, run_reason):
    clean_state = sanitize_state(state)
    now_local = app_now()
    manual_target = parse_manual_settlement_reason(run_reason)
    include_today = now_local.hour >= 12 or manual_target is not None
    today_local = now_local.date()
    today_iso = today_local.isoformat()

    settled_payments = 0
    settled_incomes = 0
    balance_delta = 0.0
    ledger_events = []

    expenses = list(clean_state.get("expenseEntries", []))
    incomes = list(clean_state.get("incomeEntries", []))
    payments = []
    incomes_plan = []
    next_id = next_entry_id(expenses, incomes)

    for payment in clean_state.get("payments", []):
        payment_item = sanitize_payment(payment)
        if manual_target and manual_target["type"] == "payment":
            target_occurrence = manual_target["occurrence"]
            target_id = manual_target["id"]
            is_target_payment = int(payment_item.get("id", 0)) == target_id
            can_settle_target = (
                is_target_payment
                and is_payment_occurrence_for_date(payment_item, target_occurrence)
                and not is_paid_occurrence(payment_item, target_occurrence)
            )
            due_occurrences = [target_occurrence] if can_settle_target else []
        elif manual_target and manual_target["type"] != "payment":
            due_occurrences = []
        else:
            due_occurrences = get_due_payment_occurrences(payment_item, today_local, include_today)
        if not due_occurrences:
            payments.append(payment_item)
            continue

        amount_value = abs(round_currency(payment_item.get("amount", 0)))
        paid_dates = set(normalize_date_list(payment_item.get("paidDates", [])))
        keep_item = payment_item.get("frequency") != "once"

        for occurrence in due_occurrences:
            if amount_value <= 0:
                continue
            if occurrence in paid_dates:
                continue

            settled_payments += 1
            balance_delta = round_currency(balance_delta - amount_value)
            expenses.append(
                {
                    "id": next_id,
                    "amount": amount_value,
                    "category": "zaplanowane płatności",
                    "date": occurrence,
                    "source": "planned-payment",
                    "name": sanitize_text(payment_item.get("name", ""), default=""),
                    "icon": "📅",
                }
            )
            next_id += 1
            paid_dates.add(occurrence)
            ledger_events.append(
                {
                    "referenceKey": f"settlement:payment:{int(payment_item.get('id', 0))}:{occurrence}",
                    "eventType": "settlement_payment",
                    "amount": -amount_value,
                    "effectiveDate": occurrence,
                    "details": {
                        "paymentId": int(payment_item.get("id", 0)),
                        "paymentName": payment_item.get("name", ""),
                        "frequency": payment_item.get("frequency", "once"),
                        "source": "planned-payment",
                        "runReason": run_reason,
                    },
                }
            )

        if keep_item:
            payment_item["paidDates"] = sorted(paid_dates)
            payments.append(payment_item)

    for income in clean_state.get("incomes", []):
        income_item = sanitize_income(income)
        if manual_target and manual_target["type"] == "income":
            target_occurrence = manual_target["occurrence"]
            target_id = manual_target["id"]
            is_target_income = int(income_item.get("id", 0)) == target_id
            can_settle_target = (
                is_target_income
                and is_income_occurrence_for_date(income_item, target_occurrence)
                and not is_received_occurrence(income_item, target_occurrence)
            )
            due_occurrences = [target_occurrence] if can_settle_target else []
        elif manual_target and manual_target["type"] != "income":
            due_occurrences = []
        else:
            due_occurrences = get_due_income_occurrences(income_item, today_local, include_today)
        if not due_occurrences:
            incomes_plan.append(income_item)
            continue

        amount_value = abs(round_currency(income_item.get("amount", 0)))
        received_dates = set(normalize_date_list(income_item.get("receivedDates", [])))
        keep_item = income_item.get("frequency") != "once"

        for occurrence in due_occurrences:
            if amount_value <= 0:
                continue
            if occurrence in received_dates:
                continue

            settled_incomes += 1
            balance_delta = round_currency(balance_delta + amount_value)
            incomes.append(
                {
                    "id": next_id,
                    "amount": amount_value,
                    "category": "zaplanowane wpływy",
                    "date": occurrence,
                    "source": "planned-income",
                    "name": sanitize_text(income_item.get("name", ""), default=""),
                    "icon": "📅",
                }
            )
            next_id += 1
            received_dates.add(occurrence)
            ledger_events.append(
                {
                    "referenceKey": f"settlement:income:{int(income_item.get('id', 0))}:{occurrence}",
                    "eventType": "settlement_income",
                    "amount": amount_value,
                    "effectiveDate": occurrence,
                    "details": {
                        "incomeId": int(income_item.get("id", 0)),
                        "incomeName": income_item.get("name", ""),
                        "frequency": income_item.get("frequency", "once"),
                        "source": "planned-income",
                        "runReason": run_reason,
                    },
                }
            )

        if keep_item:
            income_item["receivedDates"] = sorted(received_dates)
            incomes_plan.append(income_item)

    if settled_payments == 0 and settled_incomes == 0:
        return clean_state, {
            "changed": False,
            "settledPayments": 0,
            "settledIncomes": 0,
            "balanceDelta": 0.0,
            "runAt": now_local.isoformat(),
            "today": today_iso,
            "includeToday": include_today,
        }, []

    clean_state["payments"] = payments
    clean_state["incomes"] = incomes_plan
    clean_state["expenseEntries"] = sanitize_entries(expenses, "inne")
    clean_state["incomeEntries"] = sanitize_entries(incomes, "inne")
    clean_state["expenseCategoryTotals"] = build_category_totals(clean_state["expenseEntries"])
    clean_state["incomeCategoryTotals"] = build_category_totals(clean_state["incomeEntries"])
    clean_state["balance"] = round_currency(clean_state.get("balance", 0) + balance_delta)

    return clean_state, {
        "changed": True,
        "settledPayments": settled_payments,
        "settledIncomes": settled_incomes,
        "balanceDelta": round_currency(balance_delta),
        "runAt": now_local.isoformat(),
        "today": today_iso,
        "includeToday": include_today,
    }, ledger_events


def sync_transactions_from_state(clean_state, conn):
    now_iso = isoformat_utc(utcnow())
    expected_keys = {"expense": set(), "income": set()}

    def push_entries(entry_type, entries):
        for idx, entry in enumerate(entries):
            try:
                entry_id = int(entry.get("id", 0))
            except (TypeError, ValueError):
                entry_id = 0
            if entry_id <= 0:
                entry_id = 900000000000 + idx + 1

            entry_key = f"{entry_type}:{entry_id}"
            expected_keys[entry_type].add(entry_key)
            conn.execute(
                """
                INSERT INTO transactions (
                    entry_key, entry_type, amount, category, entry_date,
                    source, name, icon, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(entry_key) DO UPDATE SET
                    amount = excluded.amount,
                    category = excluded.category,
                    entry_date = excluded.entry_date,
                    source = excluded.source,
                    name = excluded.name,
                    icon = excluded.icon,
                    updated_at = excluded.updated_at
                """,
                (
                    entry_key,
                    entry_type,
                    round(float(entry.get("amount", 0) or 0), 2),
                    str(entry.get("category") or "inne"),
                    str(entry.get("date") or date.today().isoformat()),
                    str(entry.get("source") or "balance-update"),
                    str(entry.get("name") or ""),
                    str(entry.get("icon") or ""),
                    now_iso,
                    now_iso,
                ),
            )

    push_entries("expense", clean_state.get("expenseEntries", []))
    push_entries("income", clean_state.get("incomeEntries", []))

    for entry_type, keys in expected_keys.items():
        if keys:
            sorted_keys = sorted(keys)
            placeholders = ",".join("?" for _ in sorted_keys)
            conn.execute(
                f"""
                DELETE FROM transactions
                WHERE entry_type = ?
                  AND entry_key NOT IN ({placeholders})
                """,
                (entry_type, *sorted_keys),
            )
        else:
            conn.execute("DELETE FROM transactions WHERE entry_type = ?", (entry_type,))


def insert_ledger_events(conn, ledger_events):
    if not ledger_events:
        return 0

    inserted = 0
    now_iso = isoformat_utc(utcnow())
    for event in ledger_events:
        reference_key = sanitize_text(event.get("referenceKey", ""), max_length=160, allow_empty=False, default="")
        event_type = sanitize_text(event.get("eventType", ""), max_length=64, allow_empty=False, default="")
        effective_date = str(event.get("effectiveDate", "")).strip()
        amount = round_currency(event.get("amount", 0))
        details = event.get("details", {})
        if (
            not reference_key
            or not event_type
            or not is_iso_date(effective_date)
            or not isinstance(details, dict)
            or amount == 0
        ):
            continue

        event_id = str(uuid.uuid4())
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO ledger_events (
                event_id, reference_key, event_type, amount, effective_date, currency, details_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, 'PLN', ?, ?)
            """,
            (
                event_id,
                reference_key,
                event_type,
                amount,
                effective_date,
                json.dumps(details, ensure_ascii=False),
                now_iso,
            ),
        )
        if cursor.rowcount > 0:
            inserted += 1
    return inserted


def build_manual_balance_ledger_events(old_state, new_state, expected_version):
    events = []
    old_expense_ids = {
        int(entry.get("id", 0))
        for entry in old_state.get("expenseEntries", [])
        if isinstance(entry, dict)
    }
    old_income_ids = {
        int(entry.get("id", 0))
        for entry in old_state.get("incomeEntries", [])
        if isinstance(entry, dict)
    }

    tracked_delta = 0.0
    for entry in new_state.get("expenseEntries", []):
        if not isinstance(entry, dict):
            continue
        entry_id = int(entry.get("id", 0))
        source = str(entry.get("source", "")).strip()
        if entry_id in old_expense_ids or source != "balance-update":
            continue
        amount = abs(round_currency(entry.get("amount", 0)))
        if amount <= 0:
            continue
        tracked_delta = round_currency(tracked_delta - amount)
        events.append(
            {
                "referenceKey": f"manual:expense:{entry_id}",
                "eventType": "manual_balance_expense",
                "amount": -amount,
                "effectiveDate": str(entry.get("date", date.today().isoformat())),
                "details": {
                    "entryId": entry_id,
                    "category": entry.get("category", ""),
                    "name": entry.get("name", ""),
                    "source": source,
                    "expectedVersion": expected_version,
                },
            }
        )

    for entry in new_state.get("incomeEntries", []):
        if not isinstance(entry, dict):
            continue
        entry_id = int(entry.get("id", 0))
        source = str(entry.get("source", "")).strip()
        if entry_id in old_income_ids or source != "balance-update":
            continue
        amount = abs(round_currency(entry.get("amount", 0)))
        if amount <= 0:
            continue
        tracked_delta = round_currency(tracked_delta + amount)
        events.append(
            {
                "referenceKey": f"manual:income:{entry_id}",
                "eventType": "manual_balance_income",
                "amount": amount,
                "effectiveDate": str(entry.get("date", date.today().isoformat())),
                "details": {
                    "entryId": entry_id,
                    "category": entry.get("category", ""),
                    "name": entry.get("name", ""),
                    "source": source,
                    "expectedVersion": expected_version,
                },
            }
        )

    old_balance = round_currency(old_state.get("balance", 0))
    new_balance = round_currency(new_state.get("balance", 0))
    delta = round_currency(new_balance - old_balance)
    remainder = round_currency(delta - tracked_delta)
    if remainder != 0:
        events.append(
            {
                "referenceKey": f"manual:adjustment:v{int(expected_version) + 1}",
                "eventType": "manual_balance_adjustment",
                "amount": remainder,
                "effectiveDate": date.today().isoformat(),
                "details": {
                    "oldBalance": old_balance,
                    "newBalance": new_balance,
                    "trackedDelta": tracked_delta,
                    "expectedVersion": expected_version,
                },
            }
        )
    return events


def update_settlement_status(summary):
    SETTLEMENT_STATUS["lastRunAt"] = summary.get("runAt")
    SETTLEMENT_STATUS["timezone"] = APP_TIMEZONE_NAME
    SETTLEMENT_STATUS["changed"] = bool(summary.get("changed"))
    SETTLEMENT_STATUS["summary"] = {
        "settledPayments": int(summary.get("settledPayments", 0)),
        "settledIncomes": int(summary.get("settledIncomes", 0)),
        "balanceDelta": round_currency(summary.get("balanceDelta", 0)),
    }


def run_server_settlement(run_reason="auto"):
    for _ in range(3):
        current_state = read_state()
        expected_version = int(current_state.get("version", 1))
        settled_state, summary, ledger_events = apply_server_settlement(current_state, run_reason)
        if not summary.get("changed"):
            update_settlement_status(summary)
            return {
                "ok": True,
                "changed": False,
                "state": current_state,
                "summary": summary,
            }

        try:
            saved_state = write_state(
                settled_state,
                expected_version=expected_version,
                ledger_events=ledger_events,
            )
            update_settlement_status(summary)
            return {
                "ok": True,
                "changed": True,
                "state": saved_state,
                "summary": summary,
            }
        except StateConflictError:
            continue

    return {
        "ok": False,
        "changed": False,
        "state": read_state(),
        "summary": {
            "changed": False,
            "settledPayments": 0,
            "settledIncomes": 0,
            "balanceDelta": 0.0,
            "runAt": app_now().isoformat(),
            "today": app_now().date().isoformat(),
            "includeToday": app_now().hour >= 12,
        },
    }


def parse_month_range(month_value):
    if not isinstance(month_value, str):
        raise ValueError("Invalid month format")
    raw = month_value.strip()
    if len(raw) != 7 or raw[4] != "-":
        raise ValueError("Invalid month format")
    try:
        year = int(raw[:4])
        month = int(raw[5:7])
    except ValueError as exc:
        raise ValueError("Invalid month format") from exc
    if month < 1 or month > 12:
        raise ValueError("Invalid month format")

    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start.isoformat(), end.isoformat()


def read_transactions_for_month(entry_type, month_value):
    if entry_type not in {"expense", "income"}:
        raise ValueError("Invalid transaction type")
    start_date, end_date = parse_month_range(month_value)

    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            rows = conn.execute(
                """
                SELECT entry_key, amount, category, entry_date, source, name, icon
                FROM transactions
                WHERE entry_type = ?
                  AND entry_date >= ?
                  AND entry_date < ?
                ORDER BY entry_date DESC, id DESC
                """,
                (entry_type, start_date, end_date),
            ).fetchall()
        finally:
            conn.close()

    entries = []
    totals_by_category = {}
    total_amount = 0.0

    for row in rows:
        amount = round(float(row[1] or 0), 2)
        category = str(row[2] or "inne")
        entry_key = str(row[0] or "")
        entry_id = 0
        try:
            _, raw_id = entry_key.split(":", 1)
            entry_id = int(raw_id)
        except (ValueError, TypeError):
            entry_id = 0

        entry = {
            "id": entry_id,
            "amount": amount,
            "category": category,
            "date": str(row[3] or ""),
            "source": str(row[4] or ""),
            "name": str(row[5] or ""),
            "icon": str(row[6] or ""),
        }
        entries.append(entry)
        totals_by_category[category] = round(totals_by_category.get(category, 0.0) + amount, 2)
        total_amount = round(total_amount + amount, 2)

    return {
        "type": entry_type,
        "month": month_value,
        "entries": entries,
        "totalsByCategory": totals_by_category,
        "totalAmount": round(total_amount, 2),
    }


def get_backup_dir():
    raw_backup_dir = str(os.getenv("BACKUP_DIR", "")).strip()
    if raw_backup_dir:
        return Path(raw_backup_dir)

    if DB_PATH.parent and str(DB_PATH.parent) not in ("", "."):
        return DB_PATH.parent / "backups"
    return Path("backups")


def trim_old_backups(backup_dir):
    backups = sorted(
        backup_dir.glob("budget_*.db"),
        key=lambda file_path: file_path.stat().st_mtime,
        reverse=True,
    )
    for stale_backup in backups[BACKUP_RETENTION_COUNT:]:
        try:
            stale_backup.unlink()
        except OSError:
            pass


def create_db_backup():
    backup_dir = get_backup_dir()
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"budget_{timestamp}.db"
    temp_file = backup_dir / f".{backup_file.name}.tmp"

    try:
        with DB_LOCK:
            source_conn = sqlite3.connect(DB_PATH)
            try:
                target_conn = sqlite3.connect(temp_file)
                try:
                    source_conn.backup(target_conn)
                finally:
                    target_conn.close()
            finally:
                source_conn.close()

        os.replace(temp_file, backup_file)
        trim_old_backups(backup_dir)
        return backup_file
    except Exception as exc:
        print(f"[backup] failed: {exc}")
        try:
            if temp_file.exists():
                temp_file.unlink()
        except OSError:
            pass
        return None


def validate_sqlite_backup_file(db_file_path):
    try:
        with open(db_file_path, "rb") as handle:
            header = handle.read(16)
    except OSError as exc:
        raise ValueError("backup_read_failed") from exc

    if header != b"SQLite format 3\x00":
        raise ValueError("invalid_sqlite_header")

    try:
        conn = sqlite3.connect(db_file_path)
        try:
            quick_check_rows = conn.execute("PRAGMA quick_check").fetchall()
            if not quick_check_rows or quick_check_rows[0][0] != "ok":
                raise ValueError("sqlite_integrity_failed")

            app_state_row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_state'"
            ).fetchone()
            if app_state_row is None:
                raise ValueError("missing_app_state_table")

            required_app_state_columns = {"id", "pin", "balance", "payments", "incomes"}
            app_state_columns = {
                str(row[1] or "")
                for row in conn.execute("PRAGMA table_info(app_state)").fetchall()
            }
            if not required_app_state_columns.issubset(app_state_columns):
                raise ValueError("missing_required_columns")

            root_state_row = conn.execute(
                "SELECT id FROM app_state WHERE id = 1"
            ).fetchone()
            if root_state_row is None:
                raise ValueError("missing_primary_state_row")

            legacy_pin_row = conn.execute("SELECT pin FROM app_state WHERE id = 1").fetchone()
            legacy_pin = normalize_pin(legacy_pin_row[0]) if legacy_pin_row else ""
            has_legacy_pin = is_valid_pin(legacy_pin)

            auth_meta_table_row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_meta'"
            ).fetchone()
            has_auth_meta = auth_meta_table_row is not None

            has_auth_meta_row = False
            if has_auth_meta:
                auth_pin_row = conn.execute(
                    "SELECT id FROM auth_meta WHERE id = 1"
                ).fetchone()
                has_auth_meta_row = auth_pin_row is not None

            if not has_auth_meta_row and not has_legacy_pin:
                raise ValueError("missing_auth_pin_data")
        finally:
            conn.close()
    except sqlite3.Error as exc:
        raise ValueError("invalid_sqlite_file") from exc


def restore_db_from_backup_bytes(raw_bytes):
    payload = bytes(raw_bytes) if isinstance(raw_bytes, (bytes, bytearray)) else b""
    if not payload:
        raise ValueError("empty_backup_payload")

    if len(payload) > MAX_BACKUP_UPLOAD_BYTES:
        raise ValueError("backup_too_large")

    db_dir = DB_PATH.resolve().parent
    db_dir.mkdir(parents=True, exist_ok=True)

    timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
    temp_restore_path = db_dir / f".restore_upload_{timestamp}_{secrets.token_hex(6)}.db"

    try:
        with open(temp_restore_path, "wb") as handle:
            handle.write(payload)

        validate_sqlite_backup_file(temp_restore_path)

        pre_restore_backup = create_db_backup()
        if not pre_restore_backup or not pre_restore_backup.exists():
            raise RuntimeError("pre_restore_backup_failed")

        with DB_LOCK:
            os.replace(temp_restore_path, DB_PATH)

        init_db()
        delete_all_sessions()
        return pre_restore_backup
    finally:
        try:
            if temp_restore_path.exists():
                temp_restore_path.unlink()
        except OSError:
            pass


def start_backup_scheduler():
    def worker():
        while True:
            time.sleep(BACKUP_INTERVAL_SECONDS)
            backup_path = create_db_backup()
            if backup_path:
                print(f"[backup] created: {backup_path}")

    thread = threading.Thread(target=worker, daemon=True, name="db-backup-worker")
    thread.start()


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
                    version INTEGER NOT NULL DEFAULT 1,
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
            if "version" not in existing_columns:
                conn.execute(
                    "ALTER TABLE app_state ADD COLUMN version INTEGER NOT NULL DEFAULT 1"
                )

            conn.execute("UPDATE app_state SET expense_entries = '[]' WHERE expense_entries IS NULL")
            conn.execute("UPDATE app_state SET income_entries = '[]' WHERE income_entries IS NULL")
            conn.execute("UPDATE app_state SET expense_totals = '{}' WHERE expense_totals IS NULL")
            conn.execute("UPDATE app_state SET income_totals = '{}' WHERE income_totals IS NULL")
            conn.execute("UPDATE app_state SET version = 1 WHERE version IS NULL OR version < 1")

            row = conn.execute("SELECT id FROM app_state WHERE id = 1").fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO app_state (
                        id, pin, balance, payments, incomes,
                        expense_entries, income_entries, expense_totals, income_totals, version
                    )
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        DEPRECATED_PIN_VALUE,
                        DEFAULT_STATE["balance"],
                        json.dumps(DEFAULT_STATE["payments"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["incomes"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["expenseEntries"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["incomeEntries"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["expenseCategoryTotals"], ensure_ascii=False),
                        json.dumps(DEFAULT_STATE["incomeCategoryTotals"], ensure_ascii=False),
                    ),
                )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_meta (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    pin_hash TEXT NOT NULL,
                    pin_salt TEXT NOT NULL,
                    pin_params TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    window_start TEXT NULL,
                    locked_until TEXT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    ip TEXT NOT NULL DEFAULT '',
                    user_agent TEXT NOT NULL DEFAULT ''
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entry_key TEXT NOT NULL UNIQUE,
                    entry_type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    category TEXT NOT NULL,
                    entry_date TEXT NOT NULL,
                    source TEXT NOT NULL,
                    name TEXT NOT NULL DEFAULT '',
                    icon TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ledger_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    reference_key TEXT NOT NULL UNIQUE,
                    event_type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    effective_date TEXT NOT NULL,
                    currency TEXT NOT NULL DEFAULT 'PLN',
                    details_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_transactions_type_date
                ON transactions (entry_type, entry_date)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_transactions_type_category_date
                ON transactions (entry_type, category, entry_date)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ledger_events_type_date
                ON ledger_events (event_type, effective_date)
                """
            )

            auth_state_row = conn.execute("SELECT id FROM auth_state WHERE id = 1").fetchone()
            if auth_state_row is None:
                conn.execute(
                    """
                    INSERT INTO auth_state (id, failed_count, window_start, locked_until)
                    VALUES (1, 0, NULL, NULL)
                    """
                )

            auth_meta_row = conn.execute("SELECT id FROM auth_meta WHERE id = 1").fetchone()
            if auth_meta_row is None:
                legacy_pin_row = conn.execute("SELECT pin FROM app_state WHERE id = 1").fetchone()
                legacy_pin = normalize_pin(legacy_pin_row[0]) if legacy_pin_row else "1234"
                if not is_valid_pin(legacy_pin):
                    legacy_pin = "1234"
                pin_salt = secrets.token_hex(16)
                pin_hash = hash_pin(legacy_pin, pin_salt, PIN_SCRYPT_PARAMS)
                conn.execute(
                    """
                    INSERT INTO auth_meta (id, pin_hash, pin_salt, pin_params)
                    VALUES (1, ?, ?, ?)
                    """,
                    (
                        pin_hash,
                        pin_salt,
                        json.dumps(PIN_SCRYPT_PARAMS, ensure_ascii=False),
                    ),
                )
            conn.execute(
                "UPDATE app_state SET pin = ? WHERE id = 1",
                (DEPRECATED_PIN_VALUE,),
            )

            state_row = conn.execute(
                """
                SELECT
                    pin,
                    version,
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
            if state_row:
                clean_state = sanitize_state(
                    {
                        "pin": state_row[0],
                        "version": state_row[1],
                        "balance": state_row[2],
                        "payments": parse_json_column(state_row[3], []),
                        "incomes": parse_json_column(state_row[4], []),
                        "expenseEntries": parse_json_column(state_row[5], []),
                        "incomeEntries": parse_json_column(state_row[6], []),
                        "expenseCategoryTotals": parse_json_column(state_row[7], {}),
                        "incomeCategoryTotals": parse_json_column(state_row[8], {}),
                    }
                )
                sync_transactions_from_state(clean_state, conn)

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
                    version,
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

    payments = parse_json_column(row[3], [])
    incomes = parse_json_column(row[4], [])
    expense_entries = parse_json_column(row[5], [])
    income_entries = parse_json_column(row[6], [])
    expense_totals = parse_json_column(row[7], {})
    income_totals = parse_json_column(row[8], {})

    return sanitize_state(
        {
            "pin": row[0],
            "version": row[1],
            "balance": row[2],
            "payments": payments,
            "incomes": incomes,
            "expenseEntries": expense_entries,
            "incomeEntries": income_entries,
            "expenseCategoryTotals": expense_totals,
            "incomeCategoryTotals": income_totals,
        }
    )


def write_state(state, expected_version=None, ledger_events=None):
    raw_state = state if isinstance(state, dict) else {}
    clean_state = sanitize_state(raw_state)
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        try:
            if expected_version is not None:
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
                        version = version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1 AND version = ?
                    """,
                    (
                        DEPRECATED_PIN_VALUE,
                        clean_state["balance"],
                        json.dumps(clean_state["payments"], ensure_ascii=False),
                        json.dumps(clean_state["incomes"], ensure_ascii=False),
                        json.dumps(clean_state["expenseEntries"], ensure_ascii=False),
                        json.dumps(clean_state["incomeEntries"], ensure_ascii=False),
                        json.dumps(clean_state["expenseCategoryTotals"], ensure_ascii=False),
                        json.dumps(clean_state["incomeCategoryTotals"], ensure_ascii=False),
                        int(expected_version),
                    ),
                )
            else:
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
                        version = version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                    """,
                    (
                        DEPRECATED_PIN_VALUE,
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
                if expected_version is not None:
                    current_row = conn.execute("SELECT version FROM app_state WHERE id = 1").fetchone()
                    current_version = int(current_row[0]) if current_row else 1
                    raise StateConflictError(current_version)
                conn.execute(
                    """
                    INSERT INTO app_state (
                        id, pin, balance, payments, incomes,
                        expense_entries, income_entries, expense_totals, income_totals, version
                    )
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        DEPRECATED_PIN_VALUE,
                        clean_state["balance"],
                        json.dumps(clean_state["payments"], ensure_ascii=False),
                        json.dumps(clean_state["incomes"], ensure_ascii=False),
                        json.dumps(clean_state["expenseEntries"], ensure_ascii=False),
                        json.dumps(clean_state["incomeEntries"], ensure_ascii=False),
                        json.dumps(clean_state["expenseCategoryTotals"], ensure_ascii=False),
                        json.dumps(clean_state["incomeCategoryTotals"], ensure_ascii=False),
                    ),
                )

            version_row = conn.execute("SELECT version FROM app_state WHERE id = 1").fetchone()
            clean_state["version"] = int(version_row[0]) if version_row else 1
            clean_state["pin"] = DEPRECATED_PIN_VALUE
            sync_transactions_from_state(clean_state, conn)
            insert_ledger_events(conn, ledger_events or [])
            conn.commit()
        finally:
            conn.close()

    return clean_state


class BudgetRequestHandler(SimpleHTTPRequestHandler):
    def _add_security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        )
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "manifest-src 'self'; "
            "worker-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'",
        )

    def end_headers(self):
        self._add_security_headers()
        super().end_headers()

    def _serve_static_asset(self, route_path):
        relative_name = STATIC_FILE_WHITELIST.get(route_path)
        if not relative_name:
            self.send_error(404, "Not Found")
            return

        base_dir = Path(__file__).resolve().parent
        target_path = (base_dir / relative_name).resolve()
        if not target_path.is_file() or not path_is_within(target_path, base_dir):
            self.send_error(404, "Not Found")
            return

        try:
            payload = target_path.read_bytes()
        except OSError:
            self.send_error(500, "Unable to read static file")
            return

        content_type = mimetypes.guess_type(str(target_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_json(self, status_code, payload, extra_headers=None):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        if extra_headers:
            for header_name, header_value in extra_headers:
                self.send_header(header_name, header_value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, status_code, raw_bytes, content_type, filename):
        data = raw_bytes if isinstance(raw_bytes, (bytes, bytearray)) else bytes(raw_bytes)
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _parse_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _get_session_token(self):
        cookie_header = self.headers.get("Cookie", "")
        if not cookie_header:
            return ""

        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except Exception:
            return ""

        morsel = cookie.get(SESSION_COOKIE_NAME)
        if not morsel:
            return ""
        return morsel.value

    def _session_cookie_header(self, token):
        parts = [
            f"{SESSION_COOKIE_NAME}={token}",
            "Path=/",
            "HttpOnly",
            "SameSite=Strict",
            f"Max-Age={SESSION_TTL_SECONDS}",
        ]
        if request_is_secure(self.headers):
            parts.append("Secure")
        return "; ".join(parts)

    def _clear_session_cookie_header(self):
        header = (
            f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; "
            "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
        )
        if request_is_secure(self.headers):
            header += "; Secure"
        return header

    def _is_authenticated(self):
        token = self._get_session_token()
        return validate_session_token(token)

    def _handle_state_get(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        run_server_settlement("state_get")
        state = read_state()
        state.pop("pin", None)
        self._send_json(200, state)

    def _handle_state_put(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        payload = self._parse_json_body()
        if payload is None:
            self._send_json(400, {"error": "invalid_json"})
            return

        run_server_settlement("state_put")

        validation_errors = validate_state_payload(payload)
        if validation_errors:
            self._send_json(
                422,
                {
                    "error": "invalid_state_payload",
                    "details": validation_errors,
                },
            )
            return

        expected_version = int(payload.get("version"))
        current_state = read_state()

        payload_without_version = {
            key: value for key, value in payload.items() if key != "version"
        }
        next_state = sanitize_state(payload_without_version)
        manual_ledger_events = build_manual_balance_ledger_events(
            current_state,
            next_state,
            expected_version,
        )

        try:
            saved = write_state(
                next_state,
                expected_version=expected_version,
                ledger_events=manual_ledger_events,
            )
        except StateConflictError as exc:
            self._send_json(
                409,
                {"error": "state_conflict", "current_version": exc.current_version},
            )
            return
        saved.pop("pin", None)
        self._send_json(200, {"ok": True, "state": saved})

    def _handle_transactions_get(self, parsed):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        query = parse_qs(parsed.query or "")
        entry_type = str(query.get("type", [""])[0]).strip().lower()
        month = str(query.get("month", [""])[0]).strip()
        try:
            payload = read_transactions_for_month(entry_type, month)
        except ValueError as exc:
            self._send_json(400, {"error": "invalid_query", "message": str(exc)})
            return

        self._send_json(200, payload)

    def _handle_auth_status(self):
        self._send_json(200, {"authenticated": self._is_authenticated()})

    def _handle_settlements_status_get(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return
        self._send_json(200, dict(SETTLEMENT_STATUS))

    def _handle_settlements_run(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        payload = self._parse_json_body()
        reason = "manual"
        if isinstance(payload, dict):
            reason_raw = sanitize_text(payload.get("reason", "manual"), max_length=64, default="manual")
            if reason_raw:
                reason = reason_raw

        result = run_server_settlement(reason)
        state = result.get("state") or read_state()
        state.pop("pin", None)
        self._send_json(
            200,
            {
                "ok": bool(result.get("ok")),
                "changed": bool(result.get("changed")),
                "summary": result.get("summary", {}),
                "state": state,
            },
        )

    def _handle_storage_status_get(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return
        self._send_json(200, get_storage_status())

    def _handle_backup_download(self, parsed):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        query = parse_qs(parsed.query or "")
        backup_format = str(query.get("format", ["sqlite"])[0]).strip().lower()
        if backup_format not in ("", "sqlite"):
            self._send_json(400, {"error": "invalid_backup_format"})
            return

        backup_path = create_db_backup()
        if not backup_path or not backup_path.exists():
            self._send_json(500, {"error": "backup_failed"})
            return

        self._send_bytes(
            200,
            backup_path.read_bytes(),
            "application/x-sqlite3",
            backup_path.name,
        )

    def _handle_backup_restore(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        raw_content_type = str(self.headers.get("Content-Type", "")).strip().lower()
        content_type = raw_content_type.split(";", 1)[0].strip()
        if content_type not in ("application/x-sqlite3", "application/octet-stream"):
            self._send_json(400, {"error": "unsupported_content_type"})
            return

        raw_length = self.headers.get("Content-Length", "0")
        try:
            content_length = int(str(raw_length).strip())
        except (TypeError, ValueError):
            self._send_json(400, {"error": "invalid_content_length"})
            return

        if content_length <= 0:
            self._send_json(400, {"error": "empty_backup_payload"})
            return
        if content_length > MAX_BACKUP_UPLOAD_BYTES:
            self._send_json(413, {"error": "backup_too_large"})
            return

        raw_body = self.rfile.read(content_length)
        if len(raw_body) != content_length:
            self._send_json(400, {"error": "invalid_request_body"})
            return

        try:
            pre_restore_backup = restore_db_from_backup_bytes(raw_body)
        except ValueError as exc:
            error_code = str(exc)
            status_code = 413 if error_code == "backup_too_large" else 422
            self._send_json(status_code, {"error": error_code})
            return
        except RuntimeError as exc:
            self._send_json(500, {"error": str(exc)})
            return
        except Exception as exc:
            print(f"[backup] restore failed: {exc}")
            self._send_json(500, {"error": "restore_failed"})
            return

        self._send_json(
            200,
            {
                "ok": True,
                "preRestoreBackup": pre_restore_backup.name,
            },
            extra_headers=[("Set-Cookie", self._clear_session_cookie_header())],
        )

    def _handle_auth_login(self):
        payload = self._parse_json_body()
        if payload is None:
            self._send_json(400, {"error": "invalid_json"})
            return

        pin = normalize_pin(payload.get("pin", ""))
        if not is_valid_pin(pin):
            self._send_json(400, {"error": "invalid_pin_format"})
            return

        lockout_status = get_lockout_status()
        if lockout_status["locked"]:
            self._send_json(
                423,
                {
                    "error": "locked",
                    "retry_after_sec": lockout_status["retry_after_sec"],
                },
            )
            return

        if not verify_pin(pin):
            failed_status = register_failed_login_attempt()
            if failed_status["locked"]:
                self._send_json(
                    423,
                    {
                        "error": "locked",
                        "retry_after_sec": failed_status["retry_after_sec"],
                    },
                )
                return

            self._send_json(401, {"error": "invalid_pin"})
            return

        reset_auth_failures()
        ip_address = client_ip_from_headers(self.headers, self.client_address[0])
        user_agent = self.headers.get("User-Agent", "")
        token = create_session(ip_address, user_agent)
        self._send_json(
            200,
            {"ok": True},
            extra_headers=[("Set-Cookie", self._session_cookie_header(token))],
        )

    def _handle_auth_logout(self):
        token = self._get_session_token()
        if token:
            delete_session_token(token)

        self._send_json(
            200,
            {"ok": True},
            extra_headers=[("Set-Cookie", self._clear_session_cookie_header())],
        )

    def _handle_auth_change_pin(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        payload = self._parse_json_body()
        if payload is None:
            self._send_json(400, {"error": "invalid_json"})
            return

        current_pin = normalize_pin(payload.get("currentPin", ""))
        new_pin = normalize_pin(payload.get("newPin", ""))

        if not is_valid_pin(new_pin):
            self._send_json(400, {"error": "invalid_new_pin"})
            return

        if not verify_pin(current_pin):
            self._send_json(401, {"error": "invalid_current_pin"})
            return

        if current_pin == new_pin:
            self._send_json(400, {"error": "pin_unchanged"})
            return

        update_auth_pin(new_pin)
        reset_auth_failures()
        self._send_json(200, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._handle_state_get()
            return
        if parsed.path == "/api/settlements/status":
            self._handle_settlements_status_get()
            return
        if parsed.path == "/api/storage/status":
            self._handle_storage_status_get()
            return
        if parsed.path == "/api/backup/download":
            self._handle_backup_download(parsed)
            return
        if parsed.path == "/api/transactions":
            self._handle_transactions_get(parsed)
            return
        if parsed.path == "/api/auth/status":
            self._handle_auth_status()
            return

        self._serve_static_asset(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/settlements/run":
            self._handle_settlements_run()
            return
        if parsed.path == "/api/backup/restore":
            self._handle_backup_restore()
            return
        if parsed.path == "/api/auth/login":
            self._handle_auth_login()
            return
        if parsed.path == "/api/auth/logout":
            self._handle_auth_logout()
            return
        if parsed.path == "/api/auth/change-pin":
            self._handle_auth_change_pin()
            return

        self.send_error(404, "Not Found")

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
    enforce_storage_guard()

    storage_status = get_storage_status()
    print(
        "[storage] "
        f"safe={storage_status['safe']} "
        f"db={storage_status['dbPath']} "
        f"backupDir={storage_status['backupDir']} "
        f"requiredMount={storage_status['requiredMountPath']} "
        f"mountPresent={storage_status['requiredMountPresent']}"
    )

    init_db()
    startup_backup = create_db_backup()
    if startup_backup:
        print(f"[backup] startup backup created: {startup_backup}")
    start_backup_scheduler()

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
