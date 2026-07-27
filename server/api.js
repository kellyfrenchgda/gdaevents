"use strict";

const express = require("express");
const { db, uid, now } = require("./db");
const { requireAuth, requireAdmin } = require("./auth");

const router = express.Router();
router.use(requireAuth);

const STATES = ["WA", "SA", "NSW", "VIC", "QLD", "TAS", "NT", "ACT"];
const SPORTS = ["AFL", "AFLW", "Cricket", "Rugby Union", "Rugby League", "Football", "Basketball", "Netball", "Motorsport", "Other"];
const BRANDS = [
  "Gage Roads Brew Co", "Single Fin", "Matso's Broome Brewery", "Atomic Beer Project",
  "Alby", "Hello Sunshine", "Miller Chill", "Good Drinks (house)"
];

const str = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const allocatedFor = (eventId) =>
  db.prepare("SELECT COALESCE(SUM(seats),0) AS n FROM allocations WHERE event_id = ?").get(eventId).n;

router.get("/reference", (req, res) => res.json({ states: STATES, sports: SPORTS, brands: BRANDS }));

/* ---------- events ---------- */

router.get("/events", (req, res) => {
  const events = db.prepare("SELECT * FROM events ORDER BY start").all();
  const allocs = db.prepare("SELECT * FROM allocations ORDER BY created_at").all();
  const byEvent = new Map(events.map((e) => [e.id, Object.assign(e, { allocations: [] })]));
  for (const a of allocs) {
    const e = byEvent.get(a.event_id);
    if (e) e.allocations.push(a);
  }
  res.json({ events });
});

function readEventBody(body) {
  const type = body.type === "general" ? "general" : "sponsorship";
  const capacity = Math.max(0, Math.floor(Number(body.capacity) || 0));
  return {
    name: str(body.name, 160),
    type,
    start: str(body.start, 40),
    state: STATES.includes(body.state) ? body.state : "",
    sport: type === "general" ? "" : (SPORTS.includes(body.sport) ? body.sport : ""),
    team: type === "general" ? "" : str(body.team, 120),
    opponent: type === "general" ? "" : str(body.opponent, 120),
    venue: str(body.venue, 160),
    brand: BRANDS.includes(body.brand) ? body.brand : "",
    capacity,
    notes: str(body.notes, 2000)
  };
}

function validEvent(row) {
  if (!row.name) return "Give the event a name so it's findable on the board.";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(row.start)) return "Pick a valid date and start time.";
  if (row.capacity > 100000) return "That capacity looks wrong. Enter the seats you actually hold.";
  return null;
}

router.post("/events", requireAdmin, (req, res) => {
  const row = readEventBody(req.body);
  const bad = validEvent(row);
  if (bad) return res.status(400).json({ error: bad });

  const id = uid();
  const ts = now();
  db.prepare(
    `INSERT INTO events (id,name,type,start,state,sport,team,opponent,venue,brand,capacity,notes,created_at,updated_at)
     VALUES (@id,@name,@type,@start,@state,@sport,@team,@opponent,@venue,@brand,@capacity,@notes,@ts,@ts)`
  ).run({ ...row, id, ts });

  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  res.status(201).json({ event: Object.assign(event, { allocations: [] }) });
});

router.patch("/events/:id", requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "That event has already been removed." });

  const row = readEventBody(req.body);
  const bad = validEvent(row);
  if (bad) return res.status(400).json({ error: bad });

  const used = allocatedFor(existing.id);
  if (row.capacity < used) {
    return res.status(400).json({
      error: `Capacity can't drop below the ${used} seats already allocated. Release some first.`
    });
  }

  db.prepare(
    `UPDATE events SET name=@name, type=@type, start=@start, state=@state, sport=@sport, team=@team,
     opponent=@opponent, venue=@venue, brand=@brand, capacity=@capacity, notes=@notes, updated_at=@ts
     WHERE id=@id`
  ).run({ ...row, id: existing.id, ts: now() });

  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(existing.id);
  event.allocations = db.prepare("SELECT * FROM allocations WHERE event_id = ? ORDER BY created_at").all(event.id);
  res.json({ event });
});

router.delete("/events/:id", requireAdmin, (req, res) => {
  const info = db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: "That event has already been removed." });
  res.json({ ok: true });
});

/* ---------- allocations ---------- */

router.post("/events/:id/allocations", (req, res) => {
  const name = str(req.body.name, 120);
  const seats = Math.floor(Number(req.body.seats) || 0);
  const status = req.body.status === "pending" ? "pending" : "confirmed";

  if (!name) return res.status(400).json({ error: "Add a guest name so the seats are traceable." });
  if (seats < 1) return res.status(400).json({ error: "Allocate at least one seat." });

  try {
    const alloc = db.transaction(() => {
      const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
      if (!event) throw Object.assign(new Error("That event has already been removed."), { status: 404 });

      const left = event.capacity - allocatedFor(event.id);
      if (seats > left) {
        throw Object.assign(
          new Error(`Only ${left} seat${left === 1 ? "" : "s"} left. Reduce the number or lift the capacity.`),
          { status: 409 }
        );
      }

      const row = {
        id: uid(), event_id: event.id, name, seats, status,
        org: str(req.body.org, 160), note: str(req.body.note, 500),
        created_by: req.user.name, created_at: now()
      };
      db.prepare(
        `INSERT INTO allocations (id,event_id,name,org,seats,status,note,created_by,created_at)
         VALUES (@id,@event_id,@name,@org,@seats,@status,@note,@created_by,@created_at)`
      ).run(row);
      return row;
    })();
    res.status(201).json({ allocation: alloc });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not allocate those seats." });
  }
});

router.patch("/allocations/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM allocations WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Those seats have already been released." });
  const status = req.body.status === "pending" ? "pending" : "confirmed";
  db.prepare("UPDATE allocations SET status = ? WHERE id = ?").run(status, existing.id);
  res.json({ allocation: db.prepare("SELECT * FROM allocations WHERE id = ?").get(existing.id) });
});

router.delete("/allocations/:id", (req, res) => {
  const info = db.prepare("DELETE FROM allocations WHERE id = ?").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Those seats have already been released." });
  res.json({ ok: true });
});

module.exports = router;
