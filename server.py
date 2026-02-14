#!/usr/bin/env python3
import argparse
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_STATE = {
    "pin": "1234",
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
            conn.execute("UPDATE app_state SET pin = ? WHERE id = 1", (normalize_pin(new_pin),))
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
                legacy_pin = normalize_pin(legacy_pin_row[0]) if legacy_pin_row else DEFAULT_STATE["pin"]
                if not is_valid_pin(legacy_pin):
                    legacy_pin = DEFAULT_STATE["pin"]
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
    raw_state = state if isinstance(state, dict) else {}
    if "pin" not in raw_state:
        existing_state = read_state()
        raw_state = {**raw_state, "pin": existing_state.get("pin", DEFAULT_STATE["pin"])}

    clean_state = sanitize_state(raw_state)
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
    def _send_json(self, status_code, payload, extra_headers=None):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for header_name, header_value in extra_headers:
                self.send_header(header_name, header_value)
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

        state = read_state()
        state.pop("pin", None)
        self._send_json(200, state)

    def _handle_state_put(self):
        if not self._is_authenticated():
            self._send_json(401, {"error": "unauthorized"})
            return

        payload = self._parse_json_body()
        if payload is None:
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        saved = write_state(payload)
        saved.pop("pin", None)
        self._send_json(200, {"ok": True, "state": saved})

    def _handle_auth_status(self):
        self._send_json(200, {"authenticated": self._is_authenticated()})

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
        if parsed.path == "/api/auth/status":
            self._handle_auth_status()
            return

        if parsed.path == "/":
            self.path = "/budget-app.html"

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
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
