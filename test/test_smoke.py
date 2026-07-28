"""Smoke tests: boot the real Flask app and exercise the API."""
import os, sys, json, time, socket, tempfile, threading, unittest, urllib.request, urllib.error

PORT = 3601
BASE = f"http://127.0.0.1:{PORT}"
DATA_DIR = tempfile.mkdtemp(prefix="gda-test-")

ADMIN   = {"email": "admin@test.local",   "password": "adminpassword123"}
MANAGER = {"email": "manager@test.local", "password": "managerpassword123"}
MEMBER  = {"email": "member@test.local",  "password": "memberpassword123"}
MULTI   = {"email": "multi@test.local",   "password": "multipassword123"}

os.environ.update({
    "FLASK_ENV": "development", "PORT": str(PORT), "DATA_DIR": DATA_DIR,
    "SESSION_SECRET": "test-secret-long-enough-for-real",
    "ADMIN_EMAIL": ADMIN["email"], "ADMIN_PASSWORD": ADMIN["password"],
    "ADMIN_NAME": "Test Admin", "SEED_DEMO": "false",
})

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from server.app import app   # noqa: E402

_jars = {}

def call(jar, method, path, body=None):
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
            s = socket.create_connection(("127.0.0.1", PORT), timeout=0.5); s.close(); return True
        except OSError:
            time.sleep(0.15)
    return False

def setUpModule():
    t = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=PORT, use_reloader=False, threaded=True),
        daemon=True)
    t.start()
    if not wait_for_server():
        raise RuntimeError("Server did not start in time")


class BoardSmokeTest(unittest.TestCase):
    event_id = None

    # ---- auth basics ----

    def test_01_board_redirects_anonymous(self):
        req = urllib.request.Request(BASE + "/", method="GET")
        with urllib.request.urlopen(req) as resp:
            self.assertIn("/login", resp.geturl())

    def test_02_api_refuses_anonymous(self):
        status, _ = call("anon", "GET", "/api/events")
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
        self.assertIn("admin", data["user"]["roles"])

    # ---- user management ----

    def test_06_admin_creates_manager(self):
        status, data = call("admin", "POST", "/api/users", {
            "name": "Test Manager", "email": MANAGER["email"],
            "password": MANAGER["password"], "roles": ["manager"]
        })
        self.assertEqual(status, 201)
        self.assertEqual(data["user"]["roles"], ["manager"])

    def test_07_admin_creates_member(self):
        status, data = call("admin", "POST", "/api/users", {
            "name": "Test Member", "email": MEMBER["email"],
            "password": MEMBER["password"], "roles": ["member"]
        })
        self.assertEqual(status, 201)
        self.assertEqual(data["user"]["roles"], ["member"])

    def test_08_admin_creates_multi_role_user(self):
        status, data = call("admin", "POST", "/api/users", {
            "name": "Multi Role", "email": MULTI["email"],
            "password": MULTI["password"], "roles": ["manager", "member"]
        })
        self.assertEqual(status, 201)
        self.assertIn("manager", data["user"]["roles"])
        self.assertIn("member", data["user"]["roles"])

    def test_09_duplicate_email_refused(self):
        status, _ = call("admin", "POST", "/api/users", {
            "name": "Copycat", "email": MEMBER["email"],
            "password": "anotherpassword123", "roles": ["member"]
        })
        self.assertEqual(status, 409)

    # ---- manager can edit events ----

    def test_10_manager_can_sign_in(self):
        status, data = call("manager", "POST", "/api/login", MANAGER)
        self.assertEqual(status, 200)
        self.assertIn("manager", data["user"]["roles"])

    def test_11_manager_can_create_event(self):
        status, data = call("manager", "POST", "/api/events", {
            "name": "Round 1 — Test v Rivals", "type": "sponsorship",
            "start": "2026-09-20T18:00", "state": "WA", "sport": "AFL",
            "team": "Test Team", "opponent": "Rivals",
            "venue": "Optus Stadium", "brand": "Alby", "capacity": 10,
        })
        self.assertEqual(status, 201)
        self.assertEqual(data["event"]["capacity"], 10)
        BoardSmokeTest.event_id = data["event"]["id"]

    def test_12_manager_can_allocate_seats(self):
        status, data = call("manager", "POST", f"/api/events/{self.event_id}/allocations",
                            {"name": "Guest A", "org": "Acme", "seats": 6, "status": "confirmed"})
        self.assertEqual(status, 201)
        self.assertEqual(data["allocation"]["created_by"], "Test Manager")

    def test_13_over_allocation_refused(self):
        status, data = call("manager", "POST", f"/api/events/{self.event_id}/allocations",
                            {"name": "Guest B", "seats": 7})
        self.assertEqual(status, 409)
        self.assertIn("4 seats left", data["error"])

    def test_14_zero_seats_refused(self):
        status, _ = call("manager", "POST", f"/api/events/{self.event_id}/allocations",
                         {"name": "Guest C", "seats": 0})
        self.assertEqual(status, 400)

    def test_15_capacity_below_allocated_refused(self):
        status, data = call("manager", "PATCH", f"/api/events/{self.event_id}", {
            "name": "Round 1 — Test v Rivals", "start": "2026-09-20T18:00",
            "capacity": 3, "state": "WA", "brand": "Alby",
        })
        self.assertEqual(status, 400)
        self.assertIn("6 seats already allocated", data["error"])

    # ---- member is view-only ----

    def test_16_member_can_sign_in(self):
        status, data = call("member", "POST", "/api/login", MEMBER)
        self.assertEqual(status, 200)
        self.assertIn("member", data["user"]["roles"])

    def test_17_member_cannot_create_events(self):
        status, _ = call("member", "POST", "/api/events",
                         {"name": "X", "start": "2026-09-20T18:00", "capacity": 1})
        self.assertEqual(status, 403)

    def test_18_member_cannot_edit_events(self):
        status, _ = call("member", "PATCH", f"/api/events/{self.event_id}",
                         {"name": "Hacked", "start": "2026-09-20T18:00", "capacity": 1})
        self.assertEqual(status, 403)

    def test_19_member_cannot_delete_events(self):
        status, _ = call("member", "DELETE", f"/api/events/{self.event_id}")
        self.assertEqual(status, 403)

    def test_20_member_cannot_allocate_seats(self):
        status, _ = call("member", "POST", f"/api/events/{self.event_id}/allocations",
                         {"name": "Guest D", "seats": 2})
        self.assertEqual(status, 403)

    def test_21_member_can_view_events(self):
        status, data = call("member", "GET", "/api/events")
        self.assertEqual(status, 200)
        self.assertGreater(len(data["events"]), 0)

    def test_22_member_cannot_see_people(self):
        status, _ = call("member", "GET", "/api/users")
        self.assertEqual(status, 403)

    # ---- multi-role user ----

    def test_23_multi_role_user_can_edit(self):
        call("multi", "POST", "/api/login", MULTI)
        status, data = call("multi", "POST", f"/api/events/{self.event_id}/allocations",
                            {"name": "Guest E", "seats": 2})
        self.assertEqual(status, 201)

    # ---- admin role guards ----

    def test_24_last_admin_cannot_be_demoted(self):
        _, me = call("admin", "GET", "/api/me")
        status, _ = call("admin", "PATCH", f"/api/users/{me['user']['id']}", {"roles": ["member"]})
        self.assertEqual(status, 400)

    def test_25_admin_can_update_roles(self):
        # Promote member to also be a manager
        _, users = call("admin", "GET", "/api/users")
        member = next(u for u in users["users"] if u["email"] == MEMBER["email"])
        status, data = call("admin", "PATCH", f"/api/users/{member['id']}", {"roles": ["manager", "member"]})
        self.assertEqual(status, 200)
        self.assertIn("manager", data["user"]["roles"])
        self.assertIn("member", data["user"]["roles"])

    # ---- cascade and session ----

    def test_26_delete_event_cascades(self):
        _, data = call("admin", "GET", "/api/events")
        ev = next(e for e in data["events"] if e["id"] == self.event_id)
        self.assertGreater(len(ev["allocations"]), 0)
        status, _ = call("admin", "DELETE", f"/api/events/{self.event_id}")
        self.assertEqual(status, 200)
        _, data = call("admin", "GET", "/api/events")
        self.assertEqual(len(data["events"]), 0)

    def test_27_logout_ends_session(self):
        call("admin", "POST", "/api/logout")
        status, _ = call("admin", "GET", "/api/events")
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)


class AdminPanelTest(unittest.TestCase):
    """Tests for the admin panel: brands and teams CRUD."""

    @classmethod
    def setUpClass(cls):
        # Sign in as admin (reuse session from earlier suite if available,
        # or sign in fresh — the server is already running)
        call("adminB", "POST", "/api/login",
             {"email": "admin@test.local", "password": "adminpassword123"})
        call("memberB", "POST", "/api/login",
             {"email": "member@test.local", "password": "memberpassword123"})

    # ── brands ──────────────────────────────────────────────────────────────

    def test_b01_admin_can_list_brands(self):
        status, data = call("adminB", "GET", "/api/admin/brands")
        self.assertEqual(status, 200)
        self.assertIn("brands", data)

    def test_b02_admin_can_add_brand(self):
        status, data = call("adminB", "POST", "/api/admin/brands",
                            {"name": "Test Brew Co", "colour": "#AABBCC"})
        self.assertEqual(status, 201)
        self.assertEqual(data["brand"]["name"], "Test Brew Co")
        AdminPanelTest.brand_id = data["brand"]["id"]

    def test_b03_duplicate_brand_refused(self):
        status, _ = call("adminB", "POST", "/api/admin/brands", {"name": "Test Brew Co"})
        self.assertEqual(status, 409)

    def test_b04_admin_can_update_brand(self):
        status, data = call("adminB", "PATCH", f"/api/admin/brands/{self.brand_id}",
                            {"name": "Test Brew Co Updated", "colour": "#112233"})
        self.assertEqual(status, 200)
        self.assertEqual(data["brand"]["colour"], "#112233")

    def test_b05_member_cannot_add_brand(self):
        status, _ = call("memberB", "POST", "/api/admin/brands", {"name": "Sneaky Brand"})
        self.assertEqual(status, 403)

    def test_b06_admin_can_delete_brand(self):
        status, _ = call("adminB", "DELETE", f"/api/admin/brands/{self.brand_id}")
        self.assertEqual(status, 200)

    # ── teams ────────────────────────────────────────────────────────────────

    def test_t01_admin_can_list_teams(self):
        status, data = call("adminB", "GET", "/api/admin/teams")
        self.assertEqual(status, 200)
        self.assertIn("teams", data)

    def test_t02_admin_can_add_team(self):
        status, data = call("adminB", "POST", "/api/admin/teams",
                            {"name": "Test FC", "sport": "AFL", "state": "WA"})
        self.assertEqual(status, 201)
        self.assertEqual(data["team"]["sport"], "AFL")
        AdminPanelTest.team_id = data["team"]["id"]

    def test_t03_duplicate_team_refused(self):
        status, _ = call("adminB", "POST", "/api/admin/teams", {"name": "Test FC"})
        self.assertEqual(status, 409)

    def test_t04_admin_can_update_team(self):
        status, data = call("adminB", "PATCH", f"/api/admin/teams/{self.team_id}",
                            {"name": "Test FC", "sport": "Cricket", "state": "SA"})
        self.assertEqual(status, 200)
        self.assertEqual(data["team"]["sport"], "Cricket")

    def test_t05_member_cannot_add_team(self):
        status, _ = call("memberB", "POST", "/api/admin/teams", {"name": "Sneaky FC"})
        self.assertEqual(status, 403)

    def test_t06_admin_can_delete_team(self):
        status, _ = call("adminB", "DELETE", f"/api/admin/teams/{self.team_id}")
        self.assertEqual(status, 200)

    # ── reference endpoint includes db brands ────────────────────────────────

    def test_r01_reference_includes_brands_from_db(self):
        status, data = call("adminB", "GET", "/api/reference")
        self.assertEqual(status, 200)
        self.assertIsInstance(data["brands"], list)
        self.assertGreater(len(data["brands"]), 0)

    def test_r02_reference_includes_teams_from_db(self):
        status, data = call("adminB", "GET", "/api/reference")
        self.assertEqual(status, 200)
        self.assertIsInstance(data["teams"], list)


class EventListingTest(unittest.TestCase):
    """Guard the event listing against regressions.

    Creates one Sport event and one non-sport event, then checks every
    field that appears on the event card and in the detail sheet.
    Runs after the server is already up (setUpModule in BoardSmokeTest).
    """

    sport_id  = None
    concert_id = None

    @classmethod
    def setUpClass(cls):
        # Fresh sessions — prior suites may have logged out
        call("listAdmin", "POST", "/api/login",
             {"email": "admin@test.local", "password": "adminpassword123"})
        # manager was created in BoardSmokeTest; log back in fresh
        s, _ = call("listMgr", "POST", "/api/login",
                    {"email": "manager@test.local", "password": "managerpassword123"})
        if s != 200:
            # manager may not exist yet if tests run standalone; create via admin
            call("listAdmin", "POST", "/api/users", {
                "name": "List Manager", "email": "manager@test.local",
                "password": "managerpassword123", "roles": ["manager"]
            })
            call("listMgr", "POST", "/api/login",
                 {"email": "manager@test.local", "password": "managerpassword123"})

        # Ensure event types exist (seeded on boot, but double-check)
        status, ref = call("listAdmin", "GET", "/api/reference")
        assert status == 200, "reference endpoint failed"
        types = {t["name"]: t for t in ref.get("event_types", [])}

        # Create Sport event type if missing
        if "Sport" not in types:
            call("listAdmin", "POST", "/api/admin/event-types",
                 {"name": "Sport", "is_sport": True})
        if "Concert" not in types:
            call("listAdmin", "POST", "/api/admin/event-types",
                 {"name": "Concert", "is_sport": False})

        # Create a Sport event (manager can create)
        s, d = call("listMgr", "POST", "/api/events", {
            "name": "Test Derby", "type": "Sport", "is_sport": True,
            "start": "2027-06-01T15:00", "state": "WA", "sport": "AFL",
            "team": "Test Eagles", "opponent": "Test Dockers",
            "venue": "Test Stadium", "brand": "Alby", "capacity": 20,
            "notes": "Listing test event",
        })
        assert s == 201, f"failed to create sport event: {d}"
        cls.sport_id = d["event"]["id"]

        # Create a Concert event
        s, d = call("listMgr", "POST", "/api/events", {
            "name": "Summer Concert Series", "type": "Concert", "is_sport": False,
            "start": "2027-07-15T19:30", "state": "SA",
            "venue": "Test Arena", "brand": "Single Fin", "capacity": 50,
            "notes": "Concert listing test",
        })
        assert s == 201, f"failed to create concert event: {d}"
        cls.concert_id = d["event"]["id"]

    @classmethod
    def tearDownClass(cls):
        for eid in [cls.sport_id, cls.concert_id]:
            if eid:
                call("listAdmin", "DELETE", f"/api/events/{eid}")

    # ── event listing ───────────────────────────────────────────────────────

    def _get_event(self, eid):
        _, data = call("listAdmin", "GET", "/api/events")
        return next((e for e in data["events"] if e["id"] == eid), None)

    def test_l01_sport_event_fields(self):
        ev = self._get_event(self.sport_id)
        self.assertIsNotNone(ev, "Sport event missing from listing")
        self.assertEqual(ev["name"],     "Test Derby")
        self.assertEqual(ev["type"],     "Sport")
        self.assertEqual(ev["team"],     "Test Eagles")
        self.assertEqual(ev["opponent"], "Test Dockers")
        self.assertEqual(ev["sport"],    "AFL")
        self.assertEqual(ev["state"],    "WA")
        self.assertEqual(ev["venue"],    "Test Stadium")
        self.assertEqual(ev["brand"],    "Alby")
        self.assertEqual(ev["capacity"], 20)

    def test_l02_concert_event_fields(self):
        ev = self._get_event(self.concert_id)
        self.assertIsNotNone(ev, "Concert event missing from listing")
        self.assertEqual(ev["name"],  "Summer Concert Series")
        self.assertEqual(ev["type"],  "Concert")
        self.assertEqual(ev["team"],  "")   # no team for non-sport
        self.assertEqual(ev["sport"], "")   # no sport for non-sport
        self.assertEqual(ev["state"], "SA")
        self.assertEqual(ev["venue"], "Test Arena")

    def test_l03_sport_event_has_allocations_list(self):
        ev = self._get_event(self.sport_id)
        self.assertIn("allocations", ev)
        self.assertIsInstance(ev["allocations"], list)

    def test_l04_event_type_preserved_after_edit(self):
        """Editing an event must not lose its event type."""
        s, d = call("listMgr", "PATCH", f"/api/events/{self.sport_id}", {
            "name": "Test Derby — Updated", "type": "Sport", "is_sport": True,
            "start": "2027-06-01T15:00", "state": "WA", "sport": "AFL",
            "team": "Test Eagles", "opponent": "Test Dockers",
            "venue": "Test Stadium", "brand": "Alby", "capacity": 20,
        })
        self.assertEqual(s, 200)
        self.assertEqual(d["event"]["type"], "Sport")
        self.assertEqual(d["event"]["name"], "Test Derby — Updated")

    def test_l05_reference_includes_event_types(self):
        s, data = call("listAdmin", "GET", "/api/reference")
        self.assertEqual(s, 200)
        self.assertIn("event_types", data)
        names = [t["name"] for t in data["event_types"]]
        self.assertIn("Sport",   names)
        self.assertIn("Concert", names)

    def test_l06_reference_includes_teams_and_brands(self):
        _, data = call("listAdmin", "GET", "/api/reference")
        self.assertIsInstance(data.get("brands"), list)
        self.assertIsInstance(data.get("teams"),  list)
        self.assertGreater(len(data["brands"]), 0)

    def test_l07_events_ordered_by_start(self):
        _, data = call("listAdmin", "GET", "/api/events")
        starts = [e["start"] for e in data["events"]]
        self.assertEqual(starts, sorted(starts))

    def test_l08_capacity_and_remaining_consistent(self):
        ev = self._get_event(self.sport_id)
        allocated = sum(a["seats"] for a in ev["allocations"])
        self.assertEqual(ev["capacity"] - allocated, ev["capacity"])  # no allocs yet

    def test_l09_sport_type_flag_in_reference(self):
        _, data = call("listAdmin", "GET", "/api/reference")
        sport_type = next((t for t in data["event_types"] if t["name"] == "Sport"), None)
        self.assertIsNotNone(sport_type)
        self.assertTrue(sport_type["is_sport"])
        concert_type = next((t for t in data["event_types"] if t["name"] == "Concert"), None)
        self.assertIsNotNone(concert_type)
        self.assertFalse(concert_type["is_sport"])

    def test_l10_migration_no_legacy_types_in_listing(self):
        """No event in the listing should have type='sponsorship' or type='general'."""
        _, data = call("listAdmin", "GET", "/api/events")
        for ev in data["events"]:
            self.assertNotIn(ev["type"], ("sponsorship", "general"),
                             f"Event '{ev['name']}' still has legacy type '{ev['type']}'")
