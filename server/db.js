"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "board.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
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

CREATE INDEX IF NOT EXISTS idx_alloc_event ON allocations(event_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);
`);

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();

/* ---------- first-run bootstrap ---------- */

function bootstrap() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;

  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || password.length < 10) {
    console.error(
      "\n[setup] No users exist yet and no valid admin was supplied.\n" +
        "[setup] Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) in the Render\n" +
        "[setup] dashboard under Environment, then redeploy. Nobody can sign in until you do.\n"
    );
    return;
  }

  db.prepare(
    "INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)"
  ).run(uid(), email, process.env.ADMIN_NAME || "Administrator", bcrypt.hashSync(password, 12), "admin", now());

  console.log("[setup] Admin account created for " + email);
}

/* ---------- optional demo data ---------- */

const DEMO = [
  {
    name: "Round 22 — Crows v Dockers", type: "sponsorship", start: "2026-08-08T16:35",
    state: "SA", sport: "AFL", team: "Adelaide Crows", opponent: "Fremantle Dockers",
    venue: "Adelaide Oval", brand: "Gage Roads Brew Co", capacity: 24,
    notes: "Riverbank Stand corporate suite. Guests to arrive from 3:45pm.",
    allocations: [
      { name: "Priya Raman", org: "Liquorland SA — state buyer", seats: 4, status: "confirmed", note: "Plus partner" },
      { name: "Dean Whitmore", org: "Adelaide Oval F&B", seats: 2, status: "confirmed", note: "" },
      { name: "Sales team (SA)", org: "Internal", seats: 6, status: "pending", note: "Split across two reps" }
    ]
  },
  {
    name: "Western Derby 60", type: "sponsorship", start: "2026-08-15T19:25",
    state: "WA", sport: "AFL", team: "Fremantle Dockers", opponent: "West Coast Eagles",
    venue: "Optus Stadium", brand: "Single Fin", capacity: 40,
    notes: "Two adjoining suites, level 4. Single Fin tap takeover in the members bar.",
    allocations: [
      { name: "Cam Ellery", org: "Endeavour Group WA", seats: 8, status: "confirmed", note: "" },
      { name: "Tash Bouwer", org: "The Aviary", seats: 6, status: "confirmed", note: "Venue partner" },
      { name: "Josh Nathan", org: "Coles Liquor", seats: 4, status: "pending", note: "Awaiting confirmation" }
    ]
  },
  {
    name: "Trade Showcase — Spring range", type: "general", start: "2026-09-03T17:30",
    state: "WA", sport: "", team: "", opponent: "", venue: "Gage Roads Freo",
    brand: "Good Drinks (house)", capacity: 120,
    notes: "Full portfolio tasting for on-premise accounts. Food from 6pm.",
    allocations: [
      { name: "On-premise WA list", org: "Trade invite — batch 1", seats: 64, status: "confirmed", note: "RSVPs closed 28 Aug" },
      { name: "Brewery team", org: "Internal", seats: 12, status: "confirmed", note: "" }
    ]
  },
  {
    name: "Round 5 — Glory v Victory", type: "sponsorship", start: "2026-10-24T19:45",
    state: "WA", sport: "Football", team: "Perth Glory", opponent: "Melbourne Victory",
    venue: "HBF Park", brand: "Alby", capacity: 20, notes: "Alby branded terrace. Casual dress.",
    allocations: [{ name: "Andrea Silvestri", org: "Independent retail cluster", seats: 5, status: "pending", note: "" }]
  },
  {
    name: "Mango Festival activation", type: "general", start: "2026-11-21T14:00",
    state: "WA", sport: "", team: "", opponent: "", venue: "Matso's Broome Brewery",
    brand: "Matso's Broome Brewery", capacity: 60,
    notes: "Two-day activation. Ticket count is day one only.", allocations: []
  },
  {
    name: "BBL — Sixers v Scorchers", type: "sponsorship", start: "2026-12-18T19:15",
    state: "NSW", sport: "Cricket", team: "Sydney Sixers", opponent: "Perth Scorchers",
    venue: "Sydney Cricket Ground", brand: "Gage Roads Brew Co", capacity: 30,
    notes: "Noble Stand hospitality. Exclusive pourage across the ground.",
    allocations: [{ name: "Marcus Tan", org: "Coles Liquor NSW", seats: 6, status: "confirmed", note: "" }]
  },
  {
    name: "BBL — Renegades v Hurricanes", type: "sponsorship", start: "2027-01-09T19:15",
    state: "VIC", sport: "Cricket", team: "Melbourne Renegades", opponent: "Hobart Hurricanes",
    venue: "Marvel Stadium", brand: "Atomic Beer Project", capacity: 18, notes: "", allocations: []
  },
  {
    name: "Perth SVNS", type: "sponsorship", start: "2027-01-30T11:00",
    state: "WA", sport: "Rugby Union", team: "Perth SVNS", opponent: "", venue: "HBF Park",
    brand: "Matso's Broome Brewery", capacity: 50,
    notes: "Signage, hospitality and activation rights across the tournament weekend.", allocations: []
  },
  {
    name: "Round 14 — Broncos v Cowboys", type: "sponsorship", start: "2027-02-13T17:30",
    state: "QLD", sport: "Rugby League", team: "Brisbane Broncos", opponent: "North Queensland Cowboys",
    venue: "Suncorp Stadium", brand: "Miller Chill", capacity: 16, notes: "", allocations: []
  },
  {
    name: "Round 18 — Crows v Power", type: "sponsorship", start: "2026-07-12T15:20",
    state: "SA", sport: "AFL", team: "Adelaide Crows", opponent: "Port Adelaide",
    venue: "Adelaide Oval", brand: "Hello Sunshine", capacity: 24, notes: "Completed — all seats used.",
    allocations: [{ name: "SA trade guests", org: "Mixed retail + on-premise", seats: 24, status: "confirmed", note: "" }]
  }
];

function seedDemo() {
  if (String(process.env.SEED_DEMO).toLowerCase() !== "true") return;
  if (db.prepare("SELECT COUNT(*) AS n FROM events").get().n > 0) return;

  const insEvent = db.prepare(
    `INSERT INTO events (id,name,type,start,state,sport,team,opponent,venue,brand,capacity,notes,created_at,updated_at)
     VALUES (@id,@name,@type,@start,@state,@sport,@team,@opponent,@venue,@brand,@capacity,@notes,@ts,@ts)`
  );
  const insAlloc = db.prepare(
    `INSERT INTO allocations (id,event_id,name,org,seats,status,note,created_by,created_at)
     VALUES (@id,@event_id,@name,@org,@seats,@status,@note,'demo',@ts)`
  );

  db.transaction(() => {
    for (const e of DEMO) {
      const id = uid();
      const ts = now();
      const { allocations, ...row } = e;
      insEvent.run({ ...row, id, ts });
      for (const a of allocations) insAlloc.run({ ...a, id: uid(), event_id: id, ts });
    }
  })();

  console.log("[setup] Demo events loaded. Set SEED_DEMO=false once you add real fixtures.");
}

bootstrap();
seedDemo();

module.exports = { db, uid, now };
