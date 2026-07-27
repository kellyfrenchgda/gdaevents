"""Authentication and user management routes."""
import re
from functools import wraps

import bcrypt
from flask import Blueprint, g, jsonify, request, session

from .db import get_db, now, uid

auth_bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _public(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"]}


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return jsonify(error="Sign in to continue."), 401
        with get_db() as con:
            row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            session.clear()
            return jsonify(error="Your account no longer exists."), 401
        g.user = row
        return f(*args, **kwargs)
    return wrapper


def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if g.user["role"] != "admin":
            return jsonify(error="Only admins can change events and people."), 403
        return f(*args, **kwargs)
    return wrapper


# ---------- session ----------

@auth_bp.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    with get_db() as con:
        user = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()

    if not user or not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
        return jsonify(error="That email and password don't match an account."), 401

    session.clear()
    session["user_id"] = user["id"]
    return jsonify(user=_public(user))


@auth_bp.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@auth_bp.get("/api/me")
@require_auth
def me():
    return jsonify(user=_public(g.user))


@auth_bp.post("/api/password")
@require_auth
def change_password():
    data = request.get_json(silent=True) or {}
    current = str(data.get("current", ""))
    nxt = str(data.get("next", ""))

    if not bcrypt.checkpw(current.encode(), g.user["password_hash"].encode()):
        return jsonify(error="Current password is incorrect."), 400
    if len(nxt) < 10:
        return jsonify(error="Use at least 10 characters for the new password."), 400

    pw_hash = bcrypt.hashpw(nxt.encode(), bcrypt.gensalt()).decode()
    with get_db() as con:
        con.execute("UPDATE users SET password_hash=? WHERE id=?", (pw_hash, g.user["id"]))
    return jsonify(ok=True)


# ---------- people ----------

@auth_bp.get("/api/users")
@require_auth
@require_admin
def list_users():
    with get_db() as con:
        rows = con.execute("SELECT * FROM users ORDER BY name COLLATE NOCASE").fetchall()
    return jsonify(users=[_public(r) for r in rows])


@auth_bp.post("/api/users")
@require_auth
@require_admin
def create_user():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    name = str(data.get("name", "")).strip()
    password = str(data.get("password", ""))
    role = "admin" if data.get("role") == "admin" else "member"

    if not EMAIL_RE.match(email):
        return jsonify(error="Enter a valid email address."), 400
    if not name:
        return jsonify(error="Enter a name so allocations are traceable."), 400
    if len(password) < 10:
        return jsonify(error="Set a starting password of at least 10 characters."), 400

    with get_db() as con:
        existing = con.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            return jsonify(error="Someone already uses that email address."), 409
        pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        user_id = uid()
        con.execute(
            "INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
            (user_id, email, name, pw_hash, role, now())
        )
        row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return jsonify(user=_public(row)), 201


@auth_bp.patch("/api/users/<user_id>")
@require_auth
@require_admin
def update_user(user_id):
    data = request.get_json(silent=True) or {}
    with get_db() as con:
        target = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not target:
            return jsonify(error="That person no longer exists."), 404

        role = "admin" if data.get("role") == "admin" else "member"
        if target["role"] == "admin" and role != "admin":
            count = con.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
            if count <= 1:
                return jsonify(error="Keep at least one admin on the account."), 400

        con.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))

        if data.get("password"):
            if len(str(data["password"])) < 10:
                return jsonify(error="New password needs at least 10 characters."), 400
            pw_hash = bcrypt.hashpw(str(data["password"]).encode(), bcrypt.gensalt()).decode()
            con.execute("UPDATE users SET password_hash=? WHERE id=?", (pw_hash, user_id))

        row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return jsonify(user=_public(row))


@auth_bp.delete("/api/users/<user_id>")
@require_auth
@require_admin
def delete_user(user_id):
    if user_id == g.user["id"]:
        return jsonify(error="You can't remove your own account."), 400
    with get_db() as con:
        target = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not target:
            return jsonify(error="That person no longer exists."), 404
        if target["role"] == "admin":
            count = con.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
            if count <= 1:
                return jsonify(error="Keep at least one admin on the account."), 400
        con.execute("DELETE FROM users WHERE id=?", (user_id,))
    return jsonify(ok=True)
