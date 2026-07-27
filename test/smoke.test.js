"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 3400 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gda-test-"));

const ADMIN = { email: "admin@test.local", password: "adminpassword123" };
const MEMBER = { email: "member@test.local", password: "memberpassword123" };

let server;
const jars = {};

/* Minimal cookie handling so we can hold two sessions at once. */
async function call(jar, method, url, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (jars[jar]) headers.Cookie = jars[jar];

  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });

  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const pair = c.split(";")[0];
    if (pair.startsWith("gda.sid=")) jars[jar] = pair;
  }

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or plain text */ }
  return { status: res.status, json, text, location: res.headers.get("location") };
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js")], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      DATA_DIR,
      SESSION_SECRET: "test-secret-long-enough-for-the-check",
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      ADMIN_NAME: "Test Admin",
      SEED_DEMO: "false"
    },
    stdio: "ignore"
  });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/healthz");
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Server did not start in time");
});

after(() => {
  if (server) server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("the board redirects anonymous visitors to the login page", async () => {
  const res = await call("anon", "GET", "/");
  assert.equal(res.status, 302);
  assert.match(res.location, /\/login$/);
});

test("the API refuses anonymous requests", async () => {
  const res = await call("anon", "GET", "/api/events");
  assert.equal(res.status, 401);
});

test("the login page stays public", async () => {
  const res = await call("anon", "GET", "/login");
  assert.equal(res.status, 200);
});

test("a wrong password is rejected", async () => {
  const res = await call("bad", "POST", "/api/login", { email: ADMIN.email, password: "nope" });
  assert.equal(res.status, 401);
});

test("the bootstrap admin can sign in", async () => {
  const res = await call("admin", "POST", "/api/login", ADMIN);
  assert.equal(res.status, 200);
  assert.equal(res.json.user.role, "admin");
});

let eventId;

test("an admin can create an event", async () => {
  const res = await call("admin", "POST", "/api/events", {
    name: "Round 1 — Test v Rivals",
    type: "sponsorship",
    start: "2026-09-20T18:00",
    state: "WA",
    sport: "AFL",
    team: "Test Team",
    opponent: "Rivals",
    venue: "Optus Stadium",
    brand: "Alby",
    capacity: 10
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.event.capacity, 10);
  eventId = res.json.event.id;
});

test("an event needs a valid start time", async () => {
  const res = await call("admin", "POST", "/api/events", { name: "No date", start: "", capacity: 5 });
  assert.equal(res.status, 400);
});

test("seats can be allocated", async () => {
  const res = await call("admin", "POST", `/api/events/${eventId}/allocations`, {
    name: "Guest A", org: "Acme", seats: 6, status: "confirmed"
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.allocation.created_by, "Test Admin");
});

test("allocating more seats than remain is refused", async () => {
  const res = await call("admin", "POST", `/api/events/${eventId}/allocations`, { name: "Guest B", seats: 7 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /4 seats left/);
});

test("an allocation needs at least one seat", async () => {
  const res = await call("admin", "POST", `/api/events/${eventId}/allocations`, { name: "Guest C", seats: 0 });
  assert.equal(res.status, 400);
});

test("capacity cannot drop below seats already allocated", async () => {
  const res = await call("admin", "PATCH", `/api/events/${eventId}`, {
    name: "Round 1 — Test v Rivals", start: "2026-09-20T18:00", capacity: 3, state: "WA", brand: "Alby"
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /6 seats already allocated/);
});

test("an admin can add a member", async () => {
  const res = await call("admin", "POST", "/api/users", {
    name: "Member Mo", email: MEMBER.email, password: MEMBER.password, role: "member"
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.role, "member");
});

test("a duplicate email is refused", async () => {
  const res = await call("admin", "POST", "/api/users", {
    name: "Copycat", email: MEMBER.email, password: "anotherpassword123", role: "member"
  });
  assert.equal(res.status, 409);
});

test("a member can sign in and allocate seats", async () => {
  const login = await call("member", "POST", "/api/login", MEMBER);
  assert.equal(login.status, 200);

  const res = await call("member", "POST", `/api/events/${eventId}/allocations`, { name: "Guest D", seats: 2 });
  assert.equal(res.status, 201);
  assert.equal(res.json.allocation.created_by, "Member Mo");
});

test("a member cannot create, edit or delete events", async () => {
  const create = await call("member", "POST", "/api/events", { name: "X", start: "2026-09-20T18:00", capacity: 1 });
  assert.equal(create.status, 403);

  const remove = await call("member", "DELETE", `/api/events/${eventId}`);
  assert.equal(remove.status, 403);
});

test("a member cannot see or manage people", async () => {
  const res = await call("member", "GET", "/api/users");
  assert.equal(res.status, 403);
});

test("the last admin cannot be demoted", async () => {
  const me = await call("admin", "GET", "/api/me");
  const res = await call("admin", "PATCH", `/api/users/${me.json.user.id}`, { role: "member" });
  assert.equal(res.status, 400);
});

test("deleting an event removes its allocations", async () => {
  const before = await call("admin", "GET", "/api/events");
  const target = before.json.events.find((e) => e.id === eventId);
  assert.equal(target.allocations.length, 2);

  const del = await call("admin", "DELETE", `/api/events/${eventId}`);
  assert.equal(del.status, 200);

  const after = await call("admin", "GET", "/api/events");
  assert.equal(after.json.events.length, 0);
});

test("signing out ends the session", async () => {
  await call("admin", "POST", "/api/logout");
  const res = await call("admin", "GET", "/api/events");
  assert.equal(res.status, 401);
});
