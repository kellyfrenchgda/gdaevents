"use strict";

const path = require("path");
const express = require("express");
const session = require("express-session");
const SqliteStore = require("better-sqlite3-session-store")(session);

const { db } = require("./db");
const { router: authRouter } = require("./auth");
const apiRouter = require("./api");

const app = express();
const PROD = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3000;

if (PROD) app.set("trust proxy", 1);

const SECRET = process.env.SESSION_SECRET;
if (PROD && (!SECRET || SECRET.length < 24)) {
  console.error("[fatal] SESSION_SECRET is missing or too short. Set it in the Render dashboard.");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));

app.use(
  session({
    store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
    name: "gda.sid",
    secret: SECRET || "dev-only-secret-do-not-ship",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: PROD,
      maxAge: 12 * 60 * 60 * 1000
    }
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

app.get("/healthz", (req, res) => res.type("text/plain").send("ok"));

app.use("/api", authRouter);
app.use("/api", apiRouter);

// Gate the board behind a session; the login page stays public.
app.get(["/", "/index.html"], (req, res, next) => {
  if (!req.session || !req.session.userId) return res.redirect("/login");
  next();
});

app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"], maxAge: PROD ? "1h" : 0 }));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.status(404).sendFile(path.join(__dirname, "..", "public", "login.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something broke on our side. Try again." });
});

app.listen(PORT, () => console.log(`[gda] listening on ${PORT}`));
