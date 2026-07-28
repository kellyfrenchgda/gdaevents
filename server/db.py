"""Database initialisation, schema and seed data."""
import os
import sqlite3
import secrets
import time
from contextlib import contextmanager

import bcrypt

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "board.db")


def uid() -> str:
    return secrets.token_hex(7) + hex(int(time.time()))[2:][-4:]


def now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'sponsorship',
    start      TEXT NOT NULL,
    state      TEXT,
    sport      TEXT,
    team       TEXT,
    opponent   TEXT,
    venue      TEXT,
    brand      TEXT,
    capacity   INTEGER NOT NULL DEFAULT 0,
    notes      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allocations (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    org        TEXT,
    seats      INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'confirmed',
    note       TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS ref_teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    sport      TEXT NOT NULL DEFAULT '',
    state      TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ref_brands (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    colour     TEXT NOT NULL DEFAULT '#7A8F9C',
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alloc_event ON allocations(event_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);
"""

DEMO = [
    dict(name="Round 22 — Crows v Dockers", type="sponsorship", start="2026-08-08T16:35",
         state="SA", sport="AFL", team="Adelaide Crows", opponent="Fremantle Dockers",
         venue="Adelaide Oval", brand="Gage Roads Brew Co", capacity=24,
         notes="Riverbank Stand corporate suite. Guests to arrive from 3:45pm.",
         allocations=[
             dict(name="Priya Raman", org="Liquorland SA", seats=4, status="confirmed", note="Plus partner"),
             dict(name="Dean Whitmore", org="Adelaide Oval F&B", seats=2, status="confirmed", note=""),
             dict(name="Sales team (SA)", org="Internal", seats=6, status="pending", note="Split across two reps"),
         ]),
    dict(name="Western Derby 60", type="sponsorship", start="2026-08-15T19:25",
         state="WA", sport="AFL", team="Fremantle Dockers", opponent="West Coast Eagles",
         venue="Optus Stadium", brand="Single Fin", capacity=40,
         notes="Two adjoining suites, level 4. Single Fin tap takeover in the members bar.",
         allocations=[
             dict(name="Cam Ellery", org="Endeavour Group WA", seats=8, status="confirmed", note=""),
             dict(name="Tash Bouwer", org="The Aviary", seats=6, status="confirmed", note="Venue partner"),
             dict(name="Josh Nathan", org="Coles Liquor", seats=4, status="pending", note="Awaiting confirmation"),
         ]),
    dict(name="Trade Showcase — Spring range", type="general", start="2026-09-03T17:30",
         state="WA", sport="", team="", opponent="", venue="Gage Roads Freo",
         brand="Good Drinks (house)", capacity=120,
         notes="Full portfolio tasting for on-premise accounts. Food from 6pm.",
         allocations=[
             dict(name="On-premise WA list", org="Trade invite — batch 1", seats=64, status="confirmed", note=""),
             dict(name="Brewery team", org="Internal", seats=12, status="confirmed", note=""),
         ]),
    dict(name="Round 5 — Glory v Victory", type="sponsorship", start="2026-10-24T19:45",
         state="WA", sport="Football", team="Perth Glory", opponent="Melbourne Victory",
         venue="HBF Park", brand="Alby", capacity=20, notes="Alby branded terrace. Casual dress.",
         allocations=[dict(name="Andrea Silvestri", org="Independent retail cluster", seats=5, status="pending", note="")]),
    dict(name="Mango Festival activation", type="general", start="2026-11-21T14:00",
         state="WA", sport="", team="", opponent="", venue="Matso's Broome Brewery",
         brand="Matso's Broome Brewery", capacity=60,
         notes="Two-day activation. Ticket count is day one only.", allocations=[]),
    dict(name="BBL — Sixers v Scorchers", type="sponsorship", start="2026-12-18T19:15",
         state="NSW", sport="Cricket", team="Sydney Sixers", opponent="Perth Scorchers",
         venue="Sydney Cricket Ground", brand="Gage Roads Brew Co", capacity=30,
         notes="Noble Stand hospitality. Exclusive pourage across the ground.",
         allocations=[dict(name="Marcus Tan", org="Coles Liquor NSW", seats=6, status="confirmed", note="")]),
    dict(name="BBL — Renegades v Hurricanes", type="sponsorship", start="2027-01-09T19:15",
         state="VIC", sport="Cricket", team="Melbourne Renegades", opponent="Hobart Hurricanes",
         venue="Marvel Stadium", brand="Atomic Beer Project", capacity=18, notes="", allocations=[]),
    dict(name="Perth SVNS", type="sponsorship", start="2027-01-30T11:00",
         state="WA", sport="Rugby Union", team="Perth SVNS", opponent="",
         venue="HBF Park", brand="Matso's Broome Brewery", capacity=50,
         notes="Signage, hospitality and activation rights across the tournament weekend.", allocations=[]),
    dict(name="Round 14 — Broncos v Cowboys", type="sponsorship", start="2027-02-13T17:30",
         state="QLD", sport="Rugby League", team="Brisbane Broncos", opponent="North Queensland Cowboys",
         venue="Suncorp Stadium", brand="Miller Chill", capacity=16, notes="", allocations=[]),
    dict(name="Round 18 — Crows v Power", type="sponsorship", start="2026-07-12T15:20",
         state="SA", sport="AFL", team="Adelaide Crows", opponent="Port Adelaide",
         venue="Adelaide Oval", brand="Hello Sunshine", capacity=24, notes="Completed — all seats used.",
         allocations=[dict(name="SA trade guests", org="Mixed retail + on-premise", seats=24, status="confirmed", note="")]),
]



DEFAULT_BRANDS = [
    ("Gage Roads Brew Co",      "#0B4F8A"),
    ("Single Fin",              "#F5B301"),
    ("Matso's Broome Brewery",  "#E2571F"),
    ("Atomic Beer Project",     "#D81E5B"),
    ("Alby",                    "#1E7A45"),
    ("Hello Sunshine",          "#00A39B"),
    ("Miller Chill",            "#B3122B"),
    ("Good Drinks (house)",     "#253746"),
]

DEFAULT_TEAMS = [
    ("Adelaide Crows",           "AFL",          "SA"),
    ("Fremantle Dockers",        "AFL",          "WA"),
    ("West Coast Eagles",        "AFL",          "WA"),
    ("Perth Glory",              "Football",     "WA"),
    ("Melbourne Victory",        "Football",     "VIC"),
    ("Sydney Sixers",            "Cricket",      "NSW"),
    ("Perth Scorchers",          "Cricket",      "WA"),
    ("Melbourne Renegades",      "Cricket",      "VIC"),
    ("Hobart Hurricanes",        "Cricket",      "TAS"),
    ("Brisbane Broncos",         "Rugby League", "QLD"),
    ("North Queensland Cowboys", "Rugby League", "QLD"),
    ("Perth SVNS",               "Rugby Union",  "WA"),
]


def _seed_reference():
    with get_db() as con:
        if con.execute("SELECT COUNT(*) FROM ref_brands").fetchone()[0] == 0:
            for i, (name, colour) in enumerate(DEFAULT_BRANDS):
                con.execute(
                    "INSERT OR IGNORE INTO ref_brands (id,name,colour,sort_order) VALUES (?,?,?,?)",
                    (uid(), name, colour, i)
                )
        if con.execute("SELECT COUNT(*) FROM ref_teams").fetchone()[0] == 0:
            for i, (name, sport, state) in enumerate(DEFAULT_TEAMS):
                con.execute(
                    "INSERT OR IGNORE INTO ref_teams (id,name,sport,state,sort_order) VALUES (?,?,?,?,?)",
                    (uid(), name, sport, state, i)
                )

def init_db():
    with get_db() as con:
        con.executescript(SCHEMA)

    _seed_reference()
    _bootstrap_admin()
    _seed_demo()


def _bootstrap_admin():
    email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD", "")
    name = os.environ.get("ADMIN_NAME", "Administrator")

    with get_db() as con:
        count = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count > 0:
            return

    if not email or len(password) < 10:
        print("[setup] No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars) then restart.")
        return

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    with get_db() as con:
        con.execute(
            "INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
            (uid(), email, name, pw_hash, "admin", now())
        )
    print(f"[setup] Admin account created for {email}")


def _seed_demo():
    if os.environ.get("SEED_DEMO", "").lower() != "true":
        return
    with get_db() as con:
        if con.execute("SELECT COUNT(*) FROM events").fetchone()[0] > 0:
            return
        for e in DEMO:
            eid = uid()
            ts = now()
            con.execute(
                """INSERT INTO events
                   (id,name,type,start,state,sport,team,opponent,venue,brand,capacity,notes,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (eid, e["name"], e["type"], e["start"], e.get("state",""),
                 e.get("sport",""), e.get("team",""), e.get("opponent",""),
                 e.get("venue",""), e["brand"], e["capacity"], e.get("notes",""), ts, ts)
            )
            for a in e.get("allocations", []):
                con.execute(
                    """INSERT INTO allocations (id,event_id,name,org,seats,status,note,created_by,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (uid(), eid, a["name"], a.get("org",""), a["seats"],
                     a.get("status","confirmed"), a.get("note",""), "demo", ts)
                )
    print("[setup] Demo events loaded. Set SEED_DEMO=false once you add real fixtures.")
