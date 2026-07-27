"""Smoke tests: boot the real Flask app and exercise the API."""
import os
import sys
import json
import time
import socket
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

PORT = 3600
BASE = f"http://127.0.0.1:{PORT}"
DATA_DIR = tempfile.mkdtemp(prefix="gda-test-")

ADMIN = {"email": "admin@test.local", "password": "adminpassword123"}
MEMBER = {"email": "member@test.local", "password": "memberpassword123"}

os.environ.update({
    "FLASK_ENV": "development",
    "PORT": str(PORT),
    "DATA_DIR": DATA_DIR,
    "SESSION_SECRET": "test-secret-long-enough-for-real",
    "ADMIN_EMAIL": ADMIN["email"],
    "ADMIN_PASSWORD": ADMIN["password"],
    "ADMIN_NAME": "Test Admin",
    "SEED_DEMO": "false",
})

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from server.app import app   # noqa: E402 — must be after env vars are set

# ------------------------------------------------------------------ helpers

_jars = {}  # name -> cookie string


def call(jar: str, method: str, path: str, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if _jars.get(jar):
        headers["Cookie"] = _jars[jar]

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            cookie = resp.headers.get("Set-Cookie", "")
            if "gda.sid=" in cookie:
                _jars[jar] = cookie.split(";")[0]
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        cookie = e.headers.get("Set-Cookie", "")
        if "gda.sid=" in cookie:
            _jars[jar] = cookie.split(";")[0]
        return e.code, json.loads(raw) if raw else {}


def wait_for_server(timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            s = socket.create_connection(("127.0.0.1", PORT), timeout=0.5)
            s.close()
            return True
        except OSError:
            time.sleep(0.15)
    return False


# ------------------------------------------------------------------ setup

def setUpModule():
    server = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=PORT, use_reloader=False, threaded=True),
        daemon=True,
    )
    server.start()
    if not wait_for_server():
        raise RuntimeError("Server did not start in time")


# ------------------------------------------------------------------ tests

class BoardSmokeTest(unittest.TestCase):
    event_id = None

    def test_01_board_redirects_anonymous(self):
        # urllib follows redirects so we land on login page (200).
        # Confirm the final URL contains /login — board is inaccessible.
        req = urllib.request.Request(BASE + "/", method="GET")
        with urllib.request.urlopen(req) as resp:
            final_url = resp.geturl()
        self.assertIn("/login", final_url)

    def test_02_api_refuses_anonymous(self):
        status, data = call("anon", "GET", "/api/events")
        self.assertEqual(status, 401)

    def test_03_login_page_is_public(self):
        req = urllib.request.Request(BASE + "/login", method="GET")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)

    def test_04_wrong_password_rejected(self):
        status, _ = call("bad", "POST", "/api/login", {"email": ADMIN["email"], "password": "wrong"})
        self.assertEqual(status, 401)

    def test_05_admin_can_sign_in(self):
        status, data = call("admin", "POST", "/api/login", ADMIN)
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["role"], "admin")

    def test_06_admin_can_create_event(self):
        status, data = call("admin", "POST", "/api/events", {
            "name": "Round 1 — Test v Rivals", "type": "sponsorship",
            "start": "2026-09-20T18:00", "state": "WA", "sport": "AFL",
            "team": "Test Team", "opponent": "Rivals",
            "venue": "Optus Stadium", "brand": "Alby", "capacity": 10,
        })
        self.assertEqual(status, 201)
        self.assertEqual(data["event"]["capacity"], 10)
        BoardSmokeTest.event_id = data["event"]["id"]

    def test_07_event_needs_valid_start(self):
        status, _ = call("admin", "POST", "/api/events", {"name": "No date", "start": "", "capacity": 5})
        self.assertEqual(status, 400)

    def test_08_seats_can_be_allocated(self):
        status, data = call("admin", "POST", f"/api/events/{self.event_id}/allocations",
                            {"name": "Guest A", "org": "Acme", "seats": 6, "status": "confirmed"})
        self.assertEqual(status, 201)
        self.assertEqual(data["allocation"]["created_by"], "Test Admin")

    def test_09_over_allocation_refused(self):
        status, data = call("admin", "POST", f"/api/events/{self.event_id}/allocations",
                            {"name": "Guest B", "seats": 7})
        self.assertEqual(status, 409)
        self.assertIn("4 seats left", data["error"])

    def test_10_zero_seats_refused(self):
        status, _ = call("admin", "POST", f"/api/events/{self.event_id}/allocations",
                         {"name": "Guest C", "seats": 0})
        self.assertEqual(status, 400)

    def test_11_capacity_below_allocated_refused(self):
        status, data = call("admin", "PATCH", f"/api/events/{self.event_id}", {
            "name": "Round 1 — Test v Rivals", "start": "2026-09-20T18:00",
            "capacity": 3, "state": "WA", "brand": "Alby",
        })
        self.assertEqual(status, 400)
        self.assertIn("6 seats already allocated", data["error"])

    def test_12_admin_can_add_member(self):
        status, data = call("admin", "POST", "/api/users", {
            "name": "Member Mo", "email": MEMBER["email"],
            "password": MEMBER["password"], "role": "member",
        })
        self.assertEqual(status, 201)
        self.assertEqual(data["user"]["role"], "member")

    def test_13_duplicate_email_refused(self):
        status, _ = call("admin", "POST", "/api/users", {
            "name": "Copycat", "email": MEMBER["email"],
            "password": "anotherpassword123", "role": "member",
        })
        self.assertEqual(status, 409)

    def test_14_member_can_allocate(self):
        call("member", "POST", "/api/login", MEMBER)
        status, data = call("member", "POST", f"/api/events/{self.event_id}/allocations",
                            {"name": "Guest D", "seats": 2})
        self.assertEqual(status, 201)
        self.assertEqual(data["allocation"]["created_by"], "Member Mo")

    def test_15_member_cannot_manage_events(self):
        status, _ = call("member", "POST", "/api/events",
                         {"name": "X", "start": "2026-09-20T18:00", "capacity": 1})
        self.assertEqual(status, 403)
        status, _ = call("member", "DELETE", f"/api/events/{self.event_id}")
        self.assertEqual(status, 403)

    def test_16_member_cannot_see_people(self):
        status, _ = call("member", "GET", "/api/users")
        self.assertEqual(status, 403)

    def test_17_last_admin_cannot_be_demoted(self):
        _, me = call("admin", "GET", "/api/me")
        status, _ = call("admin", "PATCH", f"/api/users/{me['user']['id']}", {"role": "member"})
        self.assertEqual(status, 400)

    def test_18_delete_event_cascades(self):
        _, data = call("admin", "GET", "/api/events")
        ev = next(e for e in data["events"] if e["id"] == self.event_id)
        self.assertEqual(len(ev["allocations"]), 2)

        status, _ = call("admin", "DELETE", f"/api/events/{self.event_id}")
        self.assertEqual(status, 200)

        _, data = call("admin", "GET", "/api/events")
        self.assertEqual(len(data["events"]), 0)

    def test_19_logout_ends_session(self):
        call("admin", "POST", "/api/logout")
        status, _ = call("admin", "GET", "/api/events")
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)
