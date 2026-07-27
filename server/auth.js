"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { db, uid, now } = require("./db");

const router = express.Router();

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Sign in to continue." });
  }
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!u) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Your account no longer exists." });
  }
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can change events and people." });
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Wait 15 minutes and try again." }
});

/* ---------- session ---------- */

router.post("/login", loginLimiter, (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "That email and password don't match an account." });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Could not start a session. Try again." });
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("gda.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post("/password", requireAuth, (req, res) => {
  const current = String(req.body.current || "");
  const next = String(req.body.next || "");
  if (!bcrypt.compareSync(current, req.user.password_hash)) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  if (next.length < 10) {
    return res.status(400).json({ error: "Use at least 10 characters for the new password." });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(next, 12), req.user.id);
  res.json({ ok: true });
});

/* ---------- people (admin) ---------- */

router.get("/users", requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE").all();
  res.json({ users: rows.map(publicUser) });
});

router.post("/users", requireAuth, requireAdmin, (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  const role = req.body.role === "admin" ? "admin" : "member";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!name) return res.status(400).json({ error: "Enter a name so allocations are traceable." });
  if (password.length < 10) return res.status(400).json({ error: "Set a starting password of at least 10 characters." });
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: "Someone already uses that email address." });
  }

  const user = { id: uid(), email, name, password_hash: bcrypt.hashSync(password, 12), role, created_at: now() };
  db.prepare(
    "INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (@id,@email,@name,@password_hash,@role,@created_at)"
  ).run(user);
  res.status(201).json({ user: publicUser(user) });
});

router.patch("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "That person no longer exists." });

  const role = req.body.role === "admin" ? "admin" : "member";
  if (target.role === "admin" && role !== "admin") {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (admins <= 1) return res.status(400).json({ error: "Keep at least one admin on the account." });
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, target.id);

  if (typeof req.body.password === "string" && req.body.password) {
    if (req.body.password.length < 10) return res.status(400).json({ error: "New password needs at least 10 characters." });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(req.body.password, 12), target.id);
  }
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(target.id)) });
});

router.delete("/users/:id", requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove your own account." });
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "That person no longer exists." });
  if (target.role === "admin") {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (admins <= 1) return res.status(400).json({ error: "Keep at least one admin on the account." });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireAdmin };
