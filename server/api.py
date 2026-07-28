"""Events and allocations API."""
from flask import Blueprint, g, jsonify, request

from .auth import require_auth, require_admin, require_manager
from .db import get_db, now, uid

api_bp = Blueprint("api", __name__)

STATES = ["WA", "SA", "NSW", "VIC", "QLD", "TAS", "NT", "ACT"]
SPORTS = ["AFL", "AFLW", "Cricket", "Rugby Union", "Rugby League",
          "Football", "Basketball", "Netball", "Motorsport", "Other"]
def _get_brands(con):
    return [r["name"] for r in con.execute("SELECT name FROM ref_brands ORDER BY sort_order,name").fetchall()]


def _str(v, max_len=200):
    return str(v or "").strip()[:max_len]


def _allocated(con, event_id):
    row = con.execute(
        "SELECT COALESCE(SUM(seats),0) AS n FROM allocations WHERE event_id=?", (event_id,)
    ).fetchone()
    return row["n"]


def _row_to_dict(row):
    return dict(row)


def _event_with_allocs(con, event_id):
    ev = con.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if not ev:
        return None
    ev = _row_to_dict(ev)
    allocs = con.execute(
        "SELECT * FROM allocations WHERE event_id=? ORDER BY created_at", (event_id,)
    ).fetchall()
    ev["allocations"] = [_row_to_dict(a) for a in allocs]
    return ev


@api_bp.get("/api/reference")
@require_auth
def reference():
    with get_db() as con:
        brands      = _get_brands(con)
        teams       = [dict(r) for r in con.execute("SELECT * FROM ref_teams ORDER BY sort_order,name").fetchall()]
        event_types = [dict(r) for r in con.execute("SELECT * FROM ref_event_types ORDER BY sort_order,name").fetchall()]
    return jsonify(states=STATES, sports=SPORTS, brands=brands, teams=teams, event_types=event_types)


# ---------- events ----------

@api_bp.get("/api/events")
@require_auth
def list_events():
    with get_db() as con:
        events = con.execute("SELECT * FROM events ORDER BY start").fetchall()
        allocs = con.execute("SELECT * FROM allocations ORDER BY created_at").fetchall()

    by_event = {e["id"]: {**_row_to_dict(e), "allocations": []} for e in events}
    for a in allocs:
        if a["event_id"] in by_event:
            by_event[a["event_id"]]["allocations"].append(_row_to_dict(a))

    return jsonify(events=list(by_event.values()))


def _parse_event_body(data):
    event_type = "general" if data.get("type") == "general" else "sponsorship"
    try:
        capacity = max(0, int(data.get("capacity") or 0))
    except (ValueError, TypeError):
        capacity = 0
    return dict(
        name=_str(data.get("name"), 160),
        type=event_type,
        start=_str(data.get("start"), 40),
        state=data.get("state") if data.get("state") in STATES else "",
        sport="" if event_type == "general" else (data.get("sport") if data.get("sport") in SPORTS else ""),
        team="" if event_type == "general" else _str(data.get("team"), 120),
        opponent="" if event_type == "general" else _str(data.get("opponent"), 120),
        venue=_str(data.get("venue"), 160),
        brand=_str(data.get("brand"), 160),  # validated at save time against db list
        capacity=capacity,
        notes=_str(data.get("notes"), 2000),
    )


def _validate_event(row):
    if not row["name"]:
        return "Give the event a name so it's findable on the board."
    import re
    if not re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", row["start"]):
        return "Pick a valid date and start time."
    if row["capacity"] > 100000:
        return "That capacity looks wrong."
    return None


@api_bp.post("/api/events")
@require_auth
@require_manager
def create_event():
    data = request.get_json(silent=True) or {}
    row = _parse_event_body(data)
    err = _validate_event(row)
    if err:
        return jsonify(error=err), 400

    eid = uid()
    ts = now()
    with get_db() as con:
        con.execute(
            """INSERT INTO events
               (id,name,type,start,state,sport,team,opponent,venue,brand,capacity,notes,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (eid, row["name"], row["type"], row["start"], row["state"], row["sport"],
             row["team"], row["opponent"], row["venue"], row["brand"],
             row["capacity"], row["notes"], ts, ts)
        )
        ev = _event_with_allocs(con, eid)
    return jsonify(event=ev), 201


@api_bp.patch("/api/events/<event_id>")
@require_auth
@require_manager
def update_event(event_id):
    data = request.get_json(silent=True) or {}
    row = _parse_event_body(data)
    err = _validate_event(row)
    if err:
        return jsonify(error=err), 400

    with get_db() as con:
        existing = con.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if not existing:
            return jsonify(error="That event has already been removed."), 404

        used = _allocated(con, event_id)
        if row["capacity"] < used:
            return jsonify(
                error=f"Capacity can't drop below the {used} seats already allocated. Release some first."
            ), 400

        con.execute(
            """UPDATE events SET name=?,type=?,start=?,state=?,sport=?,team=?,opponent=?,
               venue=?,brand=?,capacity=?,notes=?,updated_at=? WHERE id=?""",
            (row["name"], row["type"], row["start"], row["state"], row["sport"],
             row["team"], row["opponent"], row["venue"], row["brand"],
             row["capacity"], row["notes"], now(), event_id)
        )
        ev = _event_with_allocs(con, event_id)
    return jsonify(event=ev)


@api_bp.delete("/api/events/<event_id>")
@require_auth
@require_manager
def delete_event(event_id):
    with get_db() as con:
        cur = con.execute("DELETE FROM events WHERE id=?", (event_id,))
        if cur.rowcount == 0:
            return jsonify(error="That event has already been removed."), 404
    return jsonify(ok=True)


# ---------- allocations ----------

@api_bp.post("/api/events/<event_id>/allocations")
@require_auth
@require_manager
def create_allocation(event_id):
    data = request.get_json(silent=True) or {}
    name = _str(data.get("name"), 120)
    try:
        seats = max(0, int(data.get("seats") or 0))
    except (ValueError, TypeError):
        seats = 0
    status = "pending" if data.get("status") == "pending" else "confirmed"

    if not name:
        return jsonify(error="Add a guest name so the seats are traceable."), 400
    if seats < 1:
        return jsonify(error="Allocate at least one seat."), 400

    with get_db() as con:
        event = con.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if not event:
            return jsonify(error="That event has already been removed."), 404

        left = event["capacity"] - _allocated(con, event_id)
        if seats > left:
            return jsonify(error=f"Only {left} seat{'s' if left != 1 else ''} left. Reduce the number or lift the capacity."), 409

        aid = uid()
        con.execute(
            """INSERT INTO allocations (id,event_id,name,org,seats,status,note,created_by,created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (aid, event_id, name, _str(data.get("org"), 160), seats, status,
             _str(data.get("note"), 500), g.user["name"], now())
        )
        alloc = con.execute("SELECT * FROM allocations WHERE id=?", (aid,)).fetchone()
    return jsonify(allocation=_row_to_dict(alloc)), 201


@api_bp.patch("/api/allocations/<alloc_id>")
@require_auth
@require_manager
def update_allocation(alloc_id):
    data = request.get_json(silent=True) or {}
    with get_db() as con:
        existing = con.execute("SELECT * FROM allocations WHERE id=?", (alloc_id,)).fetchone()
        if not existing:
            return jsonify(error="Those seats have already been released."), 404
        status = "pending" if data.get("status") == "pending" else "confirmed"
        con.execute("UPDATE allocations SET status=? WHERE id=?", (status, alloc_id))
        row = con.execute("SELECT * FROM allocations WHERE id=?", (alloc_id,)).fetchone()
    return jsonify(allocation=_row_to_dict(row))


@api_bp.delete("/api/allocations/<alloc_id>")
@require_auth
@require_manager
def delete_allocation(alloc_id):
    with get_db() as con:
        cur = con.execute("DELETE FROM allocations WHERE id=?", (alloc_id,))
        if cur.rowcount == 0:
            return jsonify(error="Those seats have already been released."), 404
    return jsonify(ok=True)


# ---------- run sheet ----------

@api_bp.get("/api/events/<event_id>/runsheet")
@require_auth
def event_runsheet(event_id):
    from flask import make_response
    from .runsheet import build_runsheet

    with get_db() as con:
        ev = con.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if not ev:
            return jsonify(error="Event not found."), 404
        allocs = con.execute(
            "SELECT * FROM allocations WHERE event_id=? ORDER BY created_at", (event_id,)
        ).fetchall()

    event_dict = _row_to_dict(ev)
    event_dict["allocations"] = [_row_to_dict(a) for a in allocs]

    pdf_bytes = build_runsheet(event_dict)
    filename = (event_dict.get("name") or "runsheet").replace(" ", "_")[:60] + ".pdf"

    resp = make_response(pdf_bytes)
    resp.headers["Content-Type"] = "application/pdf"
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"' 
    return resp
