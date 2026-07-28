"""Admin panel API: staff access levels, sporting teams, brands."""
from flask import Blueprint, g, jsonify, request
from .auth import require_auth, require_admin
from .db import get_db, uid, now

admin_bp = Blueprint("admin", __name__)

STATES = ["WA", "SA", "NSW", "VIC", "QLD", "TAS", "NT", "ACT"]
SPORTS = ["AFL", "AFLW", "Cricket", "Rugby Union", "Rugby League",
          "Football", "Basketball", "Netball", "Motorsport", "Other"]
VALID_ROLES = {"admin", "manager", "member"}


def _str(v, n=160):
    return str(v or "").strip()[:n]


# ─── reference data (used by event form dropdowns) ────────────────────────────

@admin_bp.get("/api/admin/reference")
@require_auth
def full_reference():
    """Return all editable reference data for the admin panel."""
    with get_db() as con:
        teams  = [dict(r) for r in con.execute("SELECT * FROM ref_teams  ORDER BY sort_order, name").fetchall()]
        brands = [dict(r) for r in con.execute("SELECT * FROM ref_brands ORDER BY sort_order, name").fetchall()]
    return jsonify(teams=teams, brands=brands, states=STATES, sports=SPORTS)


# ─── brands ───────────────────────────────────────────────────────────────────

@admin_bp.get("/api/admin/brands")
@require_auth
@require_admin
def list_brands():
    with get_db() as con:
        rows = con.execute("SELECT * FROM ref_brands ORDER BY sort_order, name").fetchall()
    return jsonify(brands=[dict(r) for r in rows])


@admin_bp.post("/api/admin/brands")
@require_auth
@require_admin
def create_brand():
    data = request.get_json(silent=True) or {}
    name   = _str(data.get("name"))
    colour = _str(data.get("colour", "#7A8F9C"), 20)
    if not name:
        return jsonify(error="Brand name is required."), 400
    with get_db() as con:
        if con.execute("SELECT 1 FROM ref_brands WHERE name=?", (name,)).fetchone():
            return jsonify(error="A brand with that name already exists."), 409
        max_order = con.execute("SELECT COALESCE(MAX(sort_order),0) FROM ref_brands").fetchone()[0]
        bid = uid()
        con.execute(
            "INSERT INTO ref_brands (id,name,colour,sort_order) VALUES (?,?,?,?)",
            (bid, name, colour, max_order + 1)
        )
        row = con.execute("SELECT * FROM ref_brands WHERE id=?", (bid,)).fetchone()
    return jsonify(brand=dict(row)), 201


@admin_bp.patch("/api/admin/brands/<brand_id>")
@require_auth
@require_admin
def update_brand(brand_id):
    data = request.get_json(silent=True) or {}
    with get_db() as con:
        existing = con.execute("SELECT * FROM ref_brands WHERE id=?", (brand_id,)).fetchone()
        if not existing:
            return jsonify(error="Brand not found."), 404
        name   = _str(data.get("name", existing["name"]))
        colour = _str(data.get("colour", existing["colour"]), 20)
        if not name:
            return jsonify(error="Brand name is required."), 400
        dup = con.execute("SELECT 1 FROM ref_brands WHERE name=? AND id!=?", (name, brand_id)).fetchone()
        if dup:
            return jsonify(error="Another brand already has that name."), 409
        con.execute("UPDATE ref_brands SET name=?,colour=? WHERE id=?", (name, colour, brand_id))
        row = con.execute("SELECT * FROM ref_brands WHERE id=?", (brand_id,)).fetchone()
    return jsonify(brand=dict(row))


@admin_bp.delete("/api/admin/brands/<brand_id>")
@require_auth
@require_admin
def delete_brand(brand_id):
    with get_db() as con:
        cur = con.execute("DELETE FROM ref_brands WHERE id=?", (brand_id,))
        if cur.rowcount == 0:
            return jsonify(error="Brand not found."), 404
    return jsonify(ok=True)


# ─── teams ────────────────────────────────────────────────────────────────────

@admin_bp.get("/api/admin/teams")
@require_auth
@require_admin
def list_teams():
    with get_db() as con:
        rows = con.execute("SELECT * FROM ref_teams ORDER BY sort_order, name").fetchall()
    return jsonify(teams=[dict(r) for r in rows])


@admin_bp.post("/api/admin/teams")
@require_auth
@require_admin
def create_team():
    data = request.get_json(silent=True) or {}
    name  = _str(data.get("name"))
    sport = data.get("sport", "")  if data.get("sport")  in SPORTS else ""
    state = data.get("state", "")  if data.get("state")  in STATES else ""
    if not name:
        return jsonify(error="Team name is required."), 400
    with get_db() as con:
        if con.execute("SELECT 1 FROM ref_teams WHERE name=?", (name,)).fetchone():
            return jsonify(error="A team with that name already exists."), 409
        max_order = con.execute("SELECT COALESCE(MAX(sort_order),0) FROM ref_teams").fetchone()[0]
        tid = uid()
        con.execute(
            "INSERT INTO ref_teams (id,name,sport,state,sort_order) VALUES (?,?,?,?,?)",
            (tid, name, sport, state, max_order + 1)
        )
        row = con.execute("SELECT * FROM ref_teams WHERE id=?", (tid,)).fetchone()
    return jsonify(team=dict(row)), 201


@admin_bp.patch("/api/admin/teams/<team_id>")
@require_auth
@require_admin
def update_team(team_id):
    data = request.get_json(silent=True) or {}
    with get_db() as con:
        existing = con.execute("SELECT * FROM ref_teams WHERE id=?", (team_id,)).fetchone()
        if not existing:
            return jsonify(error="Team not found."), 404
        name  = _str(data.get("name",  existing["name"]))
        sport = data.get("sport", existing["sport"]) if data.get("sport", existing["sport"]) in SPORTS else existing["sport"]
        state = data.get("state", existing["state"]) if data.get("state", existing["state"]) in STATES else existing["state"]
        if not name:
            return jsonify(error="Team name is required."), 400
        dup = con.execute("SELECT 1 FROM ref_teams WHERE name=? AND id!=?", (name, team_id)).fetchone()
        if dup:
            return jsonify(error="Another team already has that name."), 409
        con.execute("UPDATE ref_teams SET name=?,sport=?,state=? WHERE id=?", (name, sport, state, team_id))
        row = con.execute("SELECT * FROM ref_teams WHERE id=?", (team_id,)).fetchone()
    return jsonify(team=dict(row))


@admin_bp.delete("/api/admin/teams/<team_id>")
@require_auth
@require_admin
def delete_team(team_id):
    with get_db() as con:
        cur = con.execute("DELETE FROM ref_teams WHERE id=?", (team_id,))
        if cur.rowcount == 0:
            return jsonify(error="Team not found."), 404
    return jsonify(ok=True)



# ─── event types ──────────────────────────────────────────────────────────────

@admin_bp.get("/api/admin/event-types")
@require_auth
@require_admin
def list_event_types():
    with get_db() as con:
        rows = con.execute("SELECT * FROM ref_event_types ORDER BY sort_order,name").fetchall()
    return jsonify(event_types=[dict(r) for r in rows])


@admin_bp.post("/api/admin/event-types")
@require_auth
@require_admin
def create_event_type():
    data = request.get_json(silent=True) or {}
    name     = _str(data.get("name"))
    is_sport = 1 if data.get("is_sport") else 0
    if not name:
        return jsonify(error="Event type name is required."), 400
    with get_db() as con:
        if con.execute("SELECT 1 FROM ref_event_types WHERE name=?", (name,)).fetchone():
            return jsonify(error="An event type with that name already exists."), 409
        max_order = con.execute("SELECT COALESCE(MAX(sort_order),0) FROM ref_event_types").fetchone()[0]
        eid = uid()
        con.execute(
            "INSERT INTO ref_event_types (id,name,is_sport,sort_order) VALUES (?,?,?,?)",
            (eid, name, is_sport, max_order + 1)
        )
        row = con.execute("SELECT * FROM ref_event_types WHERE id=?", (eid,)).fetchone()
    return jsonify(event_type=dict(row)), 201


@admin_bp.patch("/api/admin/event-types/<et_id>")
@require_auth
@require_admin
def update_event_type(et_id):
    data = request.get_json(silent=True) or {}
    with get_db() as con:
        existing = con.execute("SELECT * FROM ref_event_types WHERE id=?", (et_id,)).fetchone()
        if not existing:
            return jsonify(error="Event type not found."), 404
        name     = _str(data.get("name", existing["name"]))
        is_sport = 1 if data.get("is_sport") else 0
        if not name:
            return jsonify(error="Event type name is required."), 400
        dup = con.execute("SELECT 1 FROM ref_event_types WHERE name=? AND id!=?", (name, et_id)).fetchone()
        if dup:
            return jsonify(error="Another event type already has that name."), 409
        con.execute("UPDATE ref_event_types SET name=?,is_sport=? WHERE id=?", (name, is_sport, et_id))
        row = con.execute("SELECT * FROM ref_event_types WHERE id=?", (et_id,)).fetchone()
    return jsonify(event_type=dict(row))


@admin_bp.delete("/api/admin/event-types/<et_id>")
@require_auth
@require_admin
def delete_event_type(et_id):
    with get_db() as con:
        cur = con.execute("DELETE FROM ref_event_types WHERE id=?", (et_id,))
        if cur.rowcount == 0:
            return jsonify(error="Event type not found."), 404
    return jsonify(ok=True)

# ─── demo data ────────────────────────────────────────────────────────────────

@admin_bp.post("/api/admin/reseed")
@require_auth
@require_admin
def reseed_demo():
    """Wipe all events/allocations and reload demo data. Admin only."""
    from .db import force_reseed
    force_reseed()
    return jsonify(ok=True, message="Demo data reloaded.")
