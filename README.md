# GDA Ticket Board

[![CI](https://github.com/kellyfrenchgda/gdaevent/actions/workflows/ci.yml/badge.svg)](https://github.com/kellyfrenchgda/gdaevent/actions/workflows/ci.yml)

Sponsorship ticket and events tracker for Good Drinks Australia. One Node service, SQLite on a
persistent disk, email-and-password logins.

- **Board** — every event in date order with start time, state, sport, team, major brand and a
  gauge showing how much of the allocation is gone.
- **Event detail** — the same fields plus seats available, and the list of who holds them.
- **Roles** — admins manage events and people; members allocate and release seats.
- **Export** — CSV of whatever is currently on screen, one row per allocation.

---

## Deploy to Render

Roughly **$7.25/month**: Starter web service ($7) plus a 1 GB persistent disk ($0.25), on a free
Hobby workspace. Check Render's pricing page before you commit — rates move.

### 1. Put the code on GitHub

The repo lives at **github.com/kellyfrenchgda/gdaevent**. The remote is already configured, so:

```bash
git push -u origin main
```

### 2. Create the service

In Render, choose **New → Blueprint** and point it at `kellyfrenchgda/gdaevent`. `render.yaml` sets up the web
service, the disk mounted at `/var/data`, and a generated session secret.

If you'd rather not use the blueprint, create a **Web Service** by hand with:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci` |
| Start command | `node server/index.js` |
| Instance type | Starter (required for a disk) |
| Health check path | `/healthz` |
| Disk | name `gda-data`, mount path `/var/data`, 1 GB |

### 3. Set the environment variables

Add these under **Environment** in the Render dashboard. Set them *before* the first deploy —
the admin account is only created on the very first boot.

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data` |
| `SESSION_SECRET` | a long random string (the blueprint generates one) |
| `ADMIN_EMAIL` | your work email |
| `ADMIN_PASSWORD` | 10+ characters, choose your own |
| `ADMIN_NAME` | your name |
| `SEED_DEMO` | `true` for the sample fixtures, `false` to start empty |

Enter these yourself — don't paste credentials into a chat or commit them to the repo.

### 4. First sign-in

Deploy, open the URL, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Then:

1. **People** in the top right → add your team. Give each person a starting password and tell them
   directly; they change it under **Password**.
2. Delete the demo events once your real fixtures are in, and set `SEED_DEMO=false`.

### 5. Optional

- **Custom domain** — Settings → Custom Domains. TLS is issued automatically.
- **Backups** — the disk isn't snapshotted on the Starter plan. To take a copy, open a shell on the
  service and run `sqlite3 /var/data/board.db ".backup /tmp/board-backup.db"`, or just export CSV
  from the board periodically.

---

## Source control and CI

The repo is set up so every push is tested before Render picks it up.

### Push it to GitHub

The remote is set to `git@github.com:kellyfrenchgda/gdaevent.git` and the first commit is already
made, so there's nothing to stage:

```bash
git push -u origin main
```

If `gdaevent` already has commits — a README created with the repo, for example — the push will be
rejected. Pull them in first:

```bash
git pull --rebase origin main
git push -u origin main
```

Using HTTPS instead of SSH:

```bash
git remote set-url origin https://github.com/kellyfrenchgda/gdaevent.git
```

### What runs on every push

`.github/workflows/ci.yml` installs dependencies and runs the test suite on Node 20 and 22, for
pushes to `main` and for every pull request. `.github/dependabot.yml` opens monthly dependency
update PRs, which CI then checks for you.

### Tests

```bash
npm test
```

19 tests in `test/smoke.test.js`. They boot the real server against a throwaway database and cover
the things that would actually hurt if they broke: anonymous access is redirected, the API rejects
unauthenticated calls, wrong passwords fail, over-allocation is refused, capacity can't drop below
seats already given out, members can't touch events or people, the last admin can't be demoted,
deleting an event clears its allocations, and signing out ends the session.

### Recommended repo settings

- **Branch protection on `main`** — github.com/kellyfrenchgda/gdaevent/settings/branches → require
  the `test` check to pass before merging. This is what stops a broken commit reaching production.
- **Private repo** — nothing secret is committed, but the allocation logic is internal.

### Render auto-deploy

`autoDeploy: true` in `render.yaml` means a merge to `main` triggers a deploy. Render doesn't wait
for GitHub Actions, so branch protection is what keeps untested code off the server — work on
branches and merge via PR rather than pushing straight to `main`.

Never commit `.env`, and keep `ADMIN_PASSWORD` and `SESSION_SECRET` in the Render dashboard only.
`.gitignore` already excludes `.env`, `node_modules/`, `data/` and the SQLite files.

---

## Run it locally

```bash
npm install
cp .env.example .env      # edit the values
set -a; source .env; set +a
npm start                 # http://localhost:3000
```

---

## Things worth knowing

**The disk pins you to one instance.** Render disables zero-downtime deploys and horizontal scaling
on services with a persistent disk, so a deploy means a few seconds of downtime. For an internal
tool with a handful of users that's fine. If you outgrow it, move to Render Postgres — the schema in
`server/db.js` ports over with minor changes, and you lose the disk cost but pick up ~$6/month for
the database.

**Capacity is enforced on the server.** Two people allocating the last seats at the same time can't
both win; the check and the insert happen in one transaction.

**Sessions live in the same database** and last 12 hours, refreshed on activity. They survive
restarts and deploys.

**No password reset email.** An admin sets a new password from the People panel. Adding real reset
emails would mean a mail provider and is the obvious next thing if the team grows.

**No audit log.** Allocations record who added them (`created_by`), but edits and deletions aren't
tracked. Worth adding if ticket allocation ever becomes contentious.

---

## Layout

```
server/
  index.js   Express app, sessions, static files
  db.js      Schema, first-run admin, demo data
  auth.js    Login, logout, password change, people management
  api.js     Events and allocations, capacity enforcement
public/
  login.html
  index.html
  app.js     Board rendering and API calls
  styles.css
test/
  smoke.test.js
.github/
  workflows/ci.yml
  dependabot.yml
render.yaml  Render blueprint
```
