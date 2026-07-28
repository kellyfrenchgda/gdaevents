"use strict";
(function () {

const BRAND_COLOURS = {
  "Gage Roads Brew Co": "#0B4F8A",
  "Single Fin": "#F5B301",
  "Matso's Broome Brewery": "#E2571F",
  "Atomic Beer Project": "#D81E5B",
  "Alby": "#1E7A45",
  "Hello Sunshine": "#00A39B",
  "Miller Chill": "#B3122B",
  "Good Drinks (house)": "#253746"
};

let me = null;
let events = [];
let reference = { states: [], sports: [], brands: [] };
let selectedId = null;
let editingId = null;
let formType = "sponsorship";
const filters = { q: "", state: "", sport: "", brand: "", past: false };

/* ---------------- utilities ---------------- */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const allocated = (ev) => (ev.allocations || []).reduce((n, a) => n + (Number(a.seats) || 0), 0);
const remaining = (ev) => Math.max(0, (Number(ev.capacity) || 0) - allocated(ev));
const isPast = (ev) => new Date(ev.start).getTime() < Date.now();
const brandColour = (b) => BRAND_COLOURS[b] || "#7A8F9C";

const getEventType = (name) => (reference.event_types || []).find(t => t.name === name) || {};
const isSportType  = (name) => !!(getEventType(name).is_sport);

const hasRole = (r) => me && Array.isArray(me.roles) && me.roles.includes(r);
const isAdmin   = () => hasRole("admin");
const isManager = () => hasRole("manager") || hasRole("admin");

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "TBC";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return h + ":" + m + ap;
}
const dayKey = (iso) => { const d = new Date(iso); return isNaN(d) ? "tbc" : d.toDateString(); };
function fmtDayParts(iso) {
  const d = new Date(iso);
  return {
    dow: d.toLocaleDateString("en-AU", { weekday: "short" }),
    dd: String(d.getDate()).padStart(2, "0"),
    mon: d.toLocaleDateString("en-AU", { month: "short" }),
    full: d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  };
}

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("bad", !!bad);
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 2600);
}

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { location.href = "/login"; throw new Error("Signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

/* ---------------- filtering ---------------- */

function visible() {
  const q = filters.q.trim().toLowerCase();
  return events
    .filter((ev) => {
      if (!filters.past && isPast(ev)) return false;
      if (filters.state && ev.state !== filters.state) return false;
      if (filters.sport && ev.sport !== filters.sport) return false;
      if (filters.brand && ev.brand !== filters.brand) return false;
      if (q) {
        const hay = [ev.name, ev.team, ev.opponent, ev.venue, ev.brand, ev.sport, ev.state, ev.notes]
          .concat((ev.allocations || []).map((a) => a.name + " " + (a.org || "")))
          .join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/* ---------------- board ---------------- */

function render() {
  const list = visible();
  const board = $("#board");
  const upcoming = events.filter((ev) => !isPast(ev));

  $("#tEvents").textContent = upcoming.length;
  $("#tLeft").textContent = upcoming.reduce((n, ev) => n + remaining(ev), 0);
  $("#tAlloc").textContent = upcoming.reduce((n, ev) => n + allocated(ev), 0);

  if (!list.length) {
    board.innerHTML =
      '<div class="empty"><h3>Nothing on the board</h3><p>' +
      (events.length
        ? "No events match these filters. Clear the search or widen the state, sport and brand filters."
        : isManager()
          ? "Add your first fixture or event to start tracking seats."
          : "No events yet. A manager or admin needs to add the first fixture.") +
      "</p>" + (isAdmin() ? '<button class="btn" id="emptyAdd">Add event</button>' : "") + "</div>";
    const b = $("#emptyAdd");
    if (b) b.onclick = () => openForm(null);
    return;
  }

  const groups = [];
  let cur = null;
  list.forEach((ev) => {
    const k = dayKey(ev.start);
    if (!cur || cur.k !== k) {
      cur = { k, parts: fmtDayParts(ev.start), items: [], past: isPast(ev) };
      groups.push(cur);
    }
    cur.items.push(ev);
    if (!isPast(ev)) cur.past = false;
  });

  let i = 0;
  board.innerHTML = groups.map((g) =>
    '<section class="daygroup' + (g.past ? " past" : "") + '">' +
      '<div class="datestamp"><div class="dow">' + esc(g.parts.dow) + "</div>" +
        '<div class="dd">' + esc(g.parts.dd) + '</div><div class="mon">' + esc(g.parts.mon) + "</div></div>" +
      '<div class="rows">' + g.items.map((ev) => eventRow(ev, i++)).join("") + "</div>" +
    "</section>"
  ).join("");

  board.querySelectorAll(".event").forEach((el) => { el.onclick = () => openSheet(el.dataset.id); });

  requestAnimationFrame(() => {
    board.querySelectorAll(".gauge").forEach((g) => {
      const p = g.dataset.pct;
      g.querySelector(".fill").style.width = p + "%";
      g.querySelector(".head").style.left = "calc(" + p + "% - 1px)";
    });
  });
}

function eventRow(ev, i) {
  const cap = Number(ev.capacity) || 0;
  const used = allocated(ev);
  const left = remaining(ev);
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const cls = left === 0 && cap > 0 ? "out" : cap && left / cap <= 0.25 ? "low" : "";
  const past = isPast(ev);
  const evIsSportRow = isSportType(ev.type);
  const line2 = evIsSportRow
    ? esc([ev.opponent ? "v " + ev.opponent : "", ev.venue].filter(Boolean).join(" · "))
    : esc(ev.venue || "Venue TBC");

  return (
    '<button class="event' + (past ? " past" : "") + '" data-id="' + ev.id +
      '" style="--keel:' + brandColour(ev.brand) + ";animation-delay:" + Math.min(i * 32, 320) + 'ms">' +
      '<div class="event-top">' +
        '<span class="time">' + esc(fmtTime(ev.start)) + "</span>" +
        '<span class="tag state">' + esc(ev.state || "—") + "</span>" +
        '<span class="tag' + (isSportType(ev.type) ? "" : " general") + '">' + esc(ev.type || "Event") + '</span>' +
        (past ? '<span class="tag">Past</span>' : "") +
      "</div>" +
      '<div class="title">' + esc(ev.name) + "</div>" +
      '<div class="sub">' + (isSportType(ev.type) && ev.team ? esc(ev.team) + (line2 ? " · " + line2 : "") : line2) + "</div>" +
      '<div class="brandline"><span class="dot"></span>Major brand <b>' + esc(ev.brand || "Unassigned") + "</b></div>" +
      '<div class="gauge-wrap">' +
        '<div class="gauge' + (left === 0 && cap ? " full" : "") + '" data-pct="' + pct +
          '" role="img" aria-label="' + used + " of " + cap + ' seats allocated"><div class="fill"></div><div class="head"></div></div>' +
        '<div class="gauge-read ' + cls + '"><span class="left">' + left + '</span> left <span class="muted">/ ' + cap + "</span></div>" +
      "</div>" +
    "</button>"
  );
}

/* ---------------- detail sheet ---------------- */

function openSheet(id) {
  const ev = events.find((e) => e.id === id);
  if (!ev) return;
  selectedId = id;

  const cap = Number(ev.capacity) || 0;
  const used = allocated(ev);
  const left = remaining(ev);
  const parts = fmtDayParts(ev.start);
  const sheetEv = ev;  // keep reference for run sheet button

  $("#sheetHead").style.setProperty("--keel", brandColour(ev.brand));
  $("#sheetWhen").textContent = parts.full + " · " + fmtTime(ev.start);
  $("#sheetTitle").textContent = ev.name;

  const evIsSport = isSportType(ev.type);
  const rows = [
    ["Start",      parts.full + ", " + fmtTime(ev.start)],
    ["Event type", ev.type || "—"],
    ["State",      ev.state || "—"],
    ...(evIsSport ? [
      ["Sport",   ev.sport || "—"],
      ["Team",    ev.team  || "—"],
      ["Fixture", ev.opponent ? ev.team + " v " + ev.opponent : ev.name],
    ] : []),
    ["Venue", ev.venue || "—"],
  ];

  const allocHtml = (ev.allocations || []).length
    ? ev.allocations.map((a) =>
        '<div class="alloc">' +
          '<div class="seats">' + (Number(a.seats) || 0) + "</div>" +
          '<div class="who"><div class="n">' + esc(a.name) + "</div>" +
            '<div class="o">' + esc([a.org, a.note].filter(Boolean).join(" — ") || (a.created_by ? "Added by " + a.created_by : "No details")) + "</div></div>" +
          '<button class="pill ' + (a.status === "confirmed" ? "confirmed" : "pending") + '" data-flip="' + a.id +
            '" title="Switch status">' + (a.status === "confirmed" ? "Confirmed" : "Pending") + "</button>" +
          '<button class="rm" data-rm="' + a.id + '" aria-label="Release seats for ' + esc(a.name) + '">✕</button>' +
        "</div>").join("")
    : '<p class="hint" style="margin:0 0 12px">No seats allocated yet. Everything is still available.</p>';

  $("#sheetBody").innerHTML =
    '<div class="seatblock">' +
      '<div class="big' + (left === 0 && cap ? " out" : "") + '">' + left + "</div>" +
      '<div class="cap">' + (left === 1 ? "seat" : "seats") + " available of " + cap + "</div>" +
      '<div class="seatgrid">' +
        '<div><div class="k">Capacity</div><div class="v">' + cap + "</div></div>" +
        '<div><div class="k">Allocated</div><div class="v">' + used + "</div></div>" +
        '<div><div class="k">Available</div><div class="v">' + left + "</div></div>" +
      "</div></div>" +

    '<div class="deflist">' +
      rows.map((r) => '<div class="r"><div class="k">' + esc(r[0]) + '</div><div class="v">' + esc(r[1]) + "</div></div>").join("") +
      '<div class="r"><div class="k">Major brand</div><div class="v brand">' +
        '<span class="dot" style="--keel:' + brandColour(ev.brand) + '"></span>' + esc(ev.brand || "Unassigned") + "</div></div>" +
      (ev.notes ? '<div class="r"><div class="k">Notes</div><div class="v">' + esc(ev.notes) + "</div></div>" : "") +
    "</div>" +

    '<h3 class="sec-h">Allocations <span class="count">' + used + " of " + cap + "</span></h3>" +
    allocHtml +

    (isManager() ? '<div class="miniform" style="margin-top:14px">' +
      '<div class="grid2">' +
        '<label class="f"><span>Guest name</span><input class="f" id="aName" placeholder="Who is going"></label>' +
        '<label class="f"><span>Company / account</span><input class="f" id="aOrg" placeholder="Optional"></label>' +
      "</div>" +
      '<div class="grid2" style="margin-top:10px">' +
        '<label class="f"><span>Seats</span><input class="f" id="aSeats" type="number" min="1" step="1" value="2"></label>' +
        '<label class="f"><span>Status</span><select class="f" id="aStatus">' +
          '<option value="confirmed">Confirmed</option><option value="pending">Pending</option></select></label>' +
      "</div>" +
      '<label class="f" style="margin-top:10px"><span>Note</span><input class="f" id="aNote" placeholder="Dietary, arrival, plus one…"></label>' +
      '<div class="warn" id="aWarn" role="alert"></div>' +
      '<button class="btn amber sm" id="btnAlloc" style="margin-top:12px">Allocate seats</button>' +
      '<div class="hint">' + left + " of " + cap + " still available.</div>" +
    "</div>" : '<p class="hint" style="margin-top:14px">Contact a manager to allocate seats.</p>');

  $("#sheetBody").querySelectorAll("[data-rm]").forEach((b) => { b.onclick = () => releaseAlloc(b.dataset.rm); });
  $("#sheetBody").querySelectorAll("[data-flip]").forEach((b) => { b.onclick = () => flipStatus(ev, b.dataset.flip); });
  $("#btnAlloc").onclick = () => addAlloc(ev.id);

  // Build footer dynamically — run sheet for everyone, edit/delete for managers+
  const sf = $("#sheetFoot");
  sf.hidden = false;
  sf.innerHTML =
    '<a class="btn ghost sm" href="/api/events/' + ev.id + '/runsheet" target="_blank">' +
      '&#8659; Run Sheet PDF</a>' +
    (isManager() ?
      '<button class="btn ghost sm" id="btnEdit" style="margin-left:8px">Edit event</button>' +
      '<button class="btn danger sm" id="btnDelete" style="margin-left:auto">Delete event</button>'
    : '');
  if (isManager()) {
    $("#btnEdit").onclick = () => openForm(selectedId);
    $("#btnDelete").onclick = deleteEvent;
  }

  $("#sheet").classList.add("on");
  $("#scrim").classList.add("on");
  $("#btnCloseSheet").focus();
}

function closeSheet() {
  $("#sheet").classList.remove("on");
  $("#scrim").classList.remove("on");
  selectedId = null;
}

/* ---------------- allocations ---------------- */

async function refresh() {
  const data = await api("GET", "/events");
  events = data.events;
}

async function addAlloc(eventId) {
  const warn = $("#aWarn");
  warn.textContent = "";
  const btn = $("#btnAlloc");
  btn.disabled = true;
  try {
    const payload = {
      name: $("#aName").value.trim(),
      org: $("#aOrg").value.trim(),
      note: $("#aNote").value.trim(),
      seats: Number($("#aSeats").value),
      status: $("#aStatus").value
    };
    await api("POST", "/events/" + eventId + "/allocations", payload);
    await refresh();
    render();
    openSheet(eventId);
    toast(payload.seats + " seat" + (payload.seats === 1 ? "" : "s") + " allocated to " + payload.name);
  } catch (err) {
    warn.textContent = err.message;
    btn.disabled = false;
  }
}

async function releaseAlloc(allocId) {
  const eventId = selectedId;
  try {
    await api("DELETE", "/allocations/" + allocId);
    await refresh();
    render();
    openSheet(eventId);
    toast("Seats released");
  } catch (err) {
    toast(err.message, true);
  }
}

async function flipStatus(ev, allocId) {
  const a = (ev.allocations || []).find((x) => x.id === allocId);
  if (!a) return;
  const next = a.status === "confirmed" ? "pending" : "confirmed";
  try {
    await api("PATCH", "/allocations/" + allocId, { status: next });
    await refresh();
    render();
    openSheet(ev.id);
    toast(a.name + " marked " + next);
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------------- event form ---------------- */

function toggleSportFields(isSport) {
  document.querySelectorAll(".sponsonly").forEach(el => { el.style.display = isSport ? "" : "none"; });
  $("#lblName").textContent = isSport ? "Fixture or event name" : "Event name";
}

function openForm(id) {
  editingId = id;
  const ev = id ? events.find((e) => e.id === id) : null;
  $("#modalTitle").textContent = ev ? "Edit event" : "Add event";
  $("#mWarn").textContent = "";
  // Set event type dropdown
  const etSel2 = $("#mEventType");
  if (etSel2 && etSel2.options.length) {
    const savedType = ev ? (ev.type || "") : "";
    const matchOpt = Array.from(etSel2.options).find(o => o.value === savedType);
    etSel2.value = matchOpt ? savedType : etSel2.options[0].value;
    toggleSportFields(isSportType(etSel2.value));
  }

  const d = ev && ev.start ? new Date(ev.start) : null;
  const pad = (n) => String(n).padStart(2, "0");
  $("#mName").value = ev ? ev.name || "" : "";
  $("#mDate").value = d && !isNaN(d) ? d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) : "";
  $("#mTime").value = d && !isNaN(d) ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : "19:00";
  $("#mSport").value = ev && ev.sport ? ev.sport : "AFL";
  $("#mTeam").value = ev ? ev.team || "" : "";
  $("#mOpp").value = ev ? ev.opponent || "" : "";
  $("#mState").value = ev && ev.state ? ev.state : "WA";
  $("#mVenue").value = ev ? ev.venue || "" : "";
  $("#mBrand").value = ev && ev.brand ? ev.brand : reference.brands[0] || "";
  $("#mCap").value = ev ? ev.capacity || 0 : "";
  $("#mNotes").value = ev ? ev.notes || "" : "";

  $("#modal").classList.add("on");
  setTimeout(() => $("#mName").focus(), 40);
}

function closeForm() { $("#modal").classList.remove("on"); editingId = null; }

async function saveForm() {
  const warn = $("#mWarn");
  warn.textContent = "";
  const btn = $("#btnSave");
  btn.disabled = true;
  try {
    const etSelS = $("#mEventType");
    const selectedType = etSelS ? etSelS.value : "Sport";
    const selectedIsSport = isSportType(selectedType);
    const payload = {
      name: $("#mName").value.trim(),
      type: selectedType,
      is_sport: selectedIsSport,
      start: ($("#mDate").value || "") + "T" + ($("#mTime").value || "00:00"),
      state: $("#mState").value,
      venue: $("#mVenue").value.trim(),
      brand: $("#mBrand").value,
      capacity: Number($("#mCap").value) || 0,
      notes: $("#mNotes").value.trim(),
      sport: selectedIsSport ? $("#mSport").value : "",
      team: selectedIsSport ? $("#mTeam").value.trim() : "",
      opponent: selectedIsSport ? $("#mOpp").value.trim() : ""
    };
    if (!$("#mDate").value) throw new Error("Pick a date — the board is ordered by start time.");

    if (editingId) await api("PATCH", "/events/" + editingId, payload);
    else await api("POST", "/events", payload);

    await refresh();
    closeForm();
    render();
    if (selectedId) openSheet(selectedId);
    toast(editingId ? "Event updated" : "Event added to the board");
  } catch (err) {
    warn.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function deleteEvent() {
  const ev = events.find((e) => e.id === selectedId);
  if (!ev) return;
  const used = allocated(ev);
  const msg = used
    ? "Delete " + (ev.team || ev.name) + "? " + used + " allocated seats will go with it."
    : "Delete " + (ev.team || ev.name) + "?";
  if (!confirm(msg)) return;
  try {
    await api("DELETE", "/events/" + ev.id);
    await refresh();
    closeSheet();
    render();
    toast("Event deleted");
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------------- admin panel ---------------- */

let adminTab = "staff";

function closeAdmin() { $("#adminPanel").classList.remove("on"); }

async function openAdmin(tab) {
  adminTab = tab || "staff";
  document.querySelectorAll(".admin-tab").forEach(b => b.classList.toggle("on", b.dataset.tab === adminTab));
  $("#adminPanel").classList.add("on");
  await drawAdminTab();
}

async function drawAdminTab() {
  const body = $("#adminBody");
  body.innerHTML = '<p class="hint" style="padding:20px">Loading…</p>';
  try {
    if (adminTab === "staff")       await drawStaff(body);
    if (adminTab === "teams")       await drawTeams(body);
    if (adminTab === "brands")      await drawBrands(body);
    if (adminTab === "event-types") await drawEventTypes(body);
  } catch(err) {
    body.innerHTML = '<p class="warn" style="padding:20px">' + esc(err.message) + "</p>";
  }
}

/* ── Staff tab ──────────────────────────────────────────────────────────── */

async function drawStaff(body) {
  const { users } = await api("GET", "/users");
  const list = users.map(u => {
    const rolePills = (u.roles || [u.role]).map(r =>
      '<span class="pill ' + (r==="admin"?"confirmed":r==="manager"?"pending":"") + '" style="margin-right:3px">' + esc(r) + '</span>'
    ).join("");
    return '<div class="ref-row" data-uid="' + u.id + '">' +
      '<div class="rname">' + esc(u.name) + '<span class="rmeta">' + esc(u.email) + '</span></div>' +
      '<div class="role-badges">' + rolePills + '</div>' +
      (u.id === me.id ? "" : '<button class="rm" data-rm-user="' + u.id + '" title="Remove access">✕</button>') +
    '</div>';
  }).join("");

  body.innerHTML = '<div style="padding:0 0 14px">' + list + '</div>' +
    '<div class="miniform">' +
      '<div class="grid2"><label class="f"><span>Name</span><input class="f" id="uName" placeholder="Jordan Blake"></label>' +
      '<label class="f"><span>Email</span><input class="f" id="uEmail" type="email" placeholder="jordan@gooddrinks.com.au"></label></div>' +
      '<div class="grid2" style="margin-top:10px"><label class="f"><span>Starting password</span><input class="f" id="uPass" type="text" placeholder="10+ characters"></label>' +
      '<label class="f"><span>Roles (tick all that apply)</span>' +
        '<div id="uRoles" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">' +
          '<label style="display:flex;align-items:center;gap:5px;font-size:14px;font-weight:normal"><input type="checkbox" value="admin" id="uRoleAdmin"> Admin</label>' +
          '<label style="display:flex;align-items:center;gap:5px;font-size:14px;font-weight:normal"><input type="checkbox" value="manager" id="uRoleManager"> Manager</label>' +
          '<label style="display:flex;align-items:center;gap:5px;font-size:14px;font-weight:normal"><input type="checkbox" value="member" id="uRoleMember" checked> Member</label>' +
        '</div></label></div>' +
      '<div class="warn" id="uWarn" role="alert"></div>' +
      '<button class="btn amber sm" id="btnAddUser" style="margin-top:12px">Add person</button>' +
      '<div class="hint" style="margin-top:8px">Share the starting password and ask them to change it after first sign-in. SSO users are auto-provisioned on first login.</div>' +
    '</div>';

  body.querySelectorAll("[data-rm-user]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Remove this person\'s access?")) return;
      try { await api("DELETE", "/users/" + b.dataset.rmUser); await drawAdminTab(); toast("Access removed"); }
      catch(err) { toast(err.message, true); }
    };
  });
  $("#btnAddUser").onclick = async () => {
    const warn = $("#uWarn"); warn.textContent = "";
    const selectedRoles = Array.from(document.querySelectorAll("#uRoles input:checked")).map(cb => cb.value);
    try {
      await api("POST", "/users", {
        name: $("#uName").value.trim(), email: $("#uEmail").value.trim(),
        password: $("#uPass").value,
        roles: selectedRoles.length ? selectedRoles : ["member"]
      });
      $("#uName").value = ""; $("#uEmail").value = ""; $("#uPass").value = "";
      await drawAdminTab(); toast("Person added");
    } catch(err) { warn.textContent = err.message; }
  };

  // Clicking a role pill toggles it (promotes/demotes)
  body.querySelectorAll(".ref-row[data-uid]").forEach(row => {
    row.querySelectorAll(".pill").forEach(pill => {
      pill.title = "Click to remove this role";
      pill.style.cursor = "pointer";
      pill.onclick = async () => {
        const uid = row.dataset.uid;
        const { users } = await api("GET", "/users");
        const user = users.find(u => u.id === uid);
        if (!user) return;
        const current = user.roles || [user.role];
        const role = pill.textContent.trim();
        const updated = current.filter(r => r !== role);
        if (!updated.length) updated.push("member");
        try { await api("PATCH", "/users/" + uid, { roles: updated }); await drawAdminTab(); toast("Role updated"); }
        catch(err) { toast(err.message, true); }
      };
    });
    // Add role button
    const addBtn = document.createElement("button");
    addBtn.className = "btn ghost sm"; addBtn.textContent = "+ Role";
    addBtn.onclick = async () => {
      const uid = row.dataset.uid;
      const { users } = await api("GET", "/users");
      const user = users.find(u => u.id === uid);
      if (!user) return;
      const current = new Set(user.roles || [user.role]);
      const choices = ["admin","manager","member"].filter(r => !current.has(r));
      if (!choices.length) { toast("Already has all roles"); return; }
      const pick = choices.length === 1 ? choices[0] : prompt("Add which role? " + choices.join(" / "));
      if (!pick || !choices.includes(pick)) return;
      const updated = [...current, pick];
      try { await api("PATCH", "/users/" + uid, { roles: updated }); await drawAdminTab(); toast("Role added"); }
      catch(err) { toast(err.message, true); }
    };
    row.querySelector(".role-badges").after(addBtn);
    row.querySelector(".role-badges").style.marginRight = "6px";
  });
}

/* ── Teams tab ──────────────────────────────────────────────────────────── */

async function drawTeams(body) {
  const { teams } = await api("GET", "/admin/teams");
  const SPORTS_LIST = reference.sports || [];
  const STATES_LIST = reference.states || [];

  const spopts = SPORTS_LIST.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  const stopts = STATES_LIST.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");

  const list = teams.map(t =>
    '<div class="ref-row">' +
      '<div class="rname">' + esc(t.name) +
        (t.sport ? '<span class="rmeta">· ' + esc(t.sport) + (t.state ? " · " + esc(t.state) : "") + '</span>' : "") +
      '</div>' +
      '<button class="rm" data-rm-team="' + t.id + '" title="Delete team">✕</button>' +
    '</div>'
  ).join("");

  body.innerHTML = '<div style="padding:0 0 14px">' + (list || '<p class="hint">No teams yet.</p>') + '</div>' +
    '<div class="miniform">' +
      '<div class="grid2">' +
        '<label class="f"><span>Team name</span><input class="f" id="tName" placeholder="Adelaide Crows"></label>' +
        '<label class="f"><span>Sport</span><select class="f" id="tSport"><option value="">— optional —</option>' + spopts + '</select></label>' +
      '</div>' +
      '<div class="grid2" style="margin-top:10px">' +
        '<label class="f"><span>State</span><select class="f" id="tState"><option value="">— optional —</option>' + stopts + '</select></label>' +
      '</div>' +
      '<div class="warn" id="tWarn" role="alert"></div>' +
      '<button class="btn amber sm" id="btnAddTeam" style="margin-top:12px">Add team</button>' +
    '</div>';

  body.querySelectorAll("[data-rm-team]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Delete this team?")) return;
      try { await api("DELETE", "/admin/teams/" + b.dataset.rmTeam); await drawAdminTab(); toast("Team removed"); }
      catch(err) { toast(err.message, true); }
    };
  });
  $("#btnAddTeam").onclick = async () => {
    const warn = $("#tWarn"); warn.textContent = "";
    try {
      await api("POST", "/admin/teams", {
        name: $("#tName").value.trim(),
        sport: $("#tSport").value,
        state: $("#tState").value,
      });
      $("#tName").value = "";
      // refresh reference for event form
      reference = await api("GET", "/reference"); fillSelects();
      await drawAdminTab(); toast("Team added");
    } catch(err) { warn.textContent = err.message; }
  };
}

/* ── Brands tab ─────────────────────────────────────────────────────────── */

async function drawBrands(body) {
  const { brands } = await api("GET", "/admin/brands");

  const list = brands.map(b =>
    '<div class="ref-row">' +
      '<span class="swatch" style="background:' + esc(b.colour) + '"></span>' +
      '<div class="rname">' + esc(b.name) + '</div>' +
      '<button class="rm" data-rm-brand="' + b.id + '" title="Delete brand">✕</button>' +
    '</div>'
  ).join("");

  body.innerHTML = '<div style="padding:0 0 14px">' + (list || '<p class="hint">No brands yet.</p>') + '</div>' +
    '<div class="miniform">' +
      '<div class="grid2">' +
        '<label class="f"><span>Brand name</span><input class="f" id="bName" placeholder="Gage Roads Brew Co"></label>' +
        '<label class="f"><span>Colour</span>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">' +
            '<input type="color" id="bColour" value="#0B4F8A" style="width:44px;height:36px;border:1px solid var(--rule);border-radius:3px;padding:2px;cursor:pointer">' +
            '<input class="f" id="bColourHex" value="#0B4F8A" placeholder="#0B4F8A" style="flex:1">' +
          '</div></label>' +
      '</div>' +
      '<div class="warn" id="bWarn" role="alert"></div>' +
      '<button class="btn amber sm" id="btnAddBrand" style="margin-top:12px">Add brand</button>' +
    '</div>';

  // Sync colour picker ↔ hex input
  body.querySelector("#bColour").oninput = e => { body.querySelector("#bColourHex").value = e.target.value; };
  body.querySelector("#bColourHex").oninput = e => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) body.querySelector("#bColour").value = e.target.value;
  };

  body.querySelectorAll("[data-rm-brand]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Delete this brand?")) return;
      try {
        await api("DELETE", "/admin/brands/" + b.dataset.rmBrand);
        reference = await api("GET", "/reference"); fillSelects();
        await drawAdminTab(); toast("Brand removed");
      } catch(err) { toast(err.message, true); }
    };
  });
  $("#btnAddBrand").onclick = async () => {
    const warn = $("#bWarn"); warn.textContent = "";
    try {
      await api("POST", "/admin/brands", {
        name: $("#bName").value.trim(),
        colour: $("#bColourHex").value.trim() || $("#bColour").value,
      });
      $("#bName").value = "";
      reference = await api("GET", "/reference"); fillSelects();
      await drawAdminTab(); toast("Brand added");
    } catch(err) { warn.textContent = err.message; }
  };
}


/* ── Event Types tab ────────────────────────────────────────────────────── */

async function drawEventTypes(body) {
  const { event_types } = await api("GET", "/admin/event-types");

  const list = event_types.map(et =>
    '<div class="ref-row">' +
      '<div class="rname">' + esc(et.name) +
        (et.is_sport ? '<span class="rmeta">· sport event</span>' : '<span class="rmeta">· general</span>') +
      '</div>' +
      '<button class="rm" data-rm-et="' + et.id + '" title="Delete event type">✕</button>' +
    '</div>'
  ).join("");

  body.innerHTML = '<div style="padding:0 0 14px">' + (list || '<p class="hint">No event types yet.</p>') + '</div>' +
    '<div class="miniform">' +
      '<div class="grid2">' +
        '<label class="f"><span>Type name</span><input class="f" id="etName" placeholder="e.g. Concert"></label>' +
        '<label class="f"><span>Shows team fields?</span>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-top:10px">' +
            '<input type="checkbox" id="etIsSport" style="accent-color:var(--focus);width:16px;height:16px">' +
            '<span style="font-size:14px">Yes — show team, opponent &amp; sport fields</span>' +
          '</div>' +
        '</label>' +
      '</div>' +
      '<div class="warn" id="etWarn" role="alert"></div>' +
      '<button class="btn amber sm" id="btnAddEt" style="margin-top:12px">Add event type</button>' +
      '<div class="hint" style="margin-top:8px">The event form shows team and opponent fields only for types marked as sport events.</div>' +
    '</div>';

  body.querySelectorAll("[data-rm-et]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Delete this event type?")) return;
      try {
        await api("DELETE", "/admin/event-types/" + b.dataset.rmEt);
        reference = await api("GET", "/reference");
        reference.event_types = reference.event_types || [];
        fillSelects();
        await drawAdminTab(); toast("Event type removed");
      } catch(err) { toast(err.message, true); }
    };
  });

  body.querySelector("#btnAddEt").onclick = async () => {
    const warn = body.querySelector("#etWarn");
    warn.textContent = "";
    try {
      await api("POST", "/admin/event-types", {
        name: body.querySelector("#etName").value.trim(),
        is_sport: body.querySelector("#etIsSport").checked,
      });
      body.querySelector("#etName").value = "";
      body.querySelector("#etIsSport").checked = false;
      reference = await api("GET", "/reference");
      reference.event_types = reference.event_types || [];
      fillSelects();
      await drawAdminTab(); toast("Event type added");
    } catch(err) { warn.textContent = err.message; }
  };
}

/* ---------------- csv ---------------- */

function exportCsv() {
  const q = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const head = ["Start", "State", "Sport", "Team", "Opponent", "Event", "Venue", "Major brand",
                "Capacity", "Allocated", "Available", "Guest", "Company", "Seats", "Status", "Note", "Added by"];
  const lines = [head.map(q).join(",")];
  visible().forEach((ev) => {
    const base = [ev.start, ev.state, ev.type === "general" ? "General event" : ev.sport, ev.team, ev.opponent,
                  ev.name, ev.venue, ev.brand, ev.capacity, allocated(ev), remaining(ev)];
    if ((ev.allocations || []).length) {
      ev.allocations.forEach((a) =>
        lines.push(base.concat([a.name, a.org, a.seats, a.status, a.note, a.created_by]).map(q).join(",")));
    } else {
      lines.push(base.concat(["", "", "", "", "", ""]).map(q).join(","));
    }
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gda-ticket-board.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast("CSV exported");
}

/* ---------------- wiring ---------------- */

function fillSelects() {
  // Filter dropdowns keep "All …" as the first option (value="") then append choices.
  const addFilter = (sel, allLabel, arr) => {
    sel.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = allLabel;
    sel.appendChild(blank);
    arr.forEach((v) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = v; sel.appendChild(o);
    });
    sel.value = "";   // always reset to "All" on every fillSelects call
  };
  // Event-form selects get a blank "— select —" first option.
  const addForm = (sel, placeholder, arr) => {
    sel.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = placeholder;
    sel.appendChild(blank);
    arr.forEach((v) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = v; sel.appendChild(o);
    });
  };
  addFilter($("#fState"), "All states",  reference.states);
  addFilter($("#fSport"), "All sports",  reference.sports);
  addFilter($("#fBrand"), "All brands",  reference.brands.map ? reference.brands : []);
  addForm($("#mState"),   "— State —",   reference.states);
  addForm($("#mSport"),   "— Sport —",   reference.sports);
  addForm($("#mBrand"),   "— Brand —",   reference.brands.map ? reference.brands : []);
  // Event type dropdown
  const etSel = $("#mEventType");
  if (etSel) {
    etSel.innerHTML = "";
    (reference.event_types || []).forEach(et => {
      const o = document.createElement("option");
      o.value = et.name; o.textContent = et.name;
      o.dataset.isSport = et.is_sport ? "1" : "0";
      etSel.appendChild(o);
    });
    etSel.onchange = () => toggleSportFields(isSportType(etSel.value));
  }
}

function wire() {
  $("#q").oninput = (e) => { filters.q = e.target.value; render(); };
  $("#fState").onchange = (e) => { filters.state = e.target.value; render(); };
  $("#fSport").onchange = (e) => { filters.sport = e.target.value; render(); };
  $("#fBrand").onchange = (e) => { filters.brand = e.target.value; render(); };
  $("#fPast").onchange = (e) => { filters.past = e.target.checked; render(); };
  $("#btnExport").onclick = exportCsv;
  $("#btnAdd").onclick = () => openForm(null);
  $("#btnCloseSheet").onclick = closeSheet;
  $("#scrim").onclick = closeSheet;
  $("#btnCancel").onclick = closeForm;
  $("#modalScrim").onclick = closeForm;
  $("#btnSave").onclick = saveForm;
  document.querySelectorAll("#typeSeg button").forEach((b) => { b.onclick = () => setFormType(b.dataset.type); });

  $("#btnAdmin").onclick = () => openAdmin("staff");
  $("#adminScrim").onclick   = closeAdmin;
  $("#btnAdminClose").onclick  = closeAdmin;
  $("#btnAdminClose2").onclick = closeAdmin;
  $("#btnReseed").onclick = async () => {
    if (!confirm("This will DELETE all current events and allocations and reload the sample data. Continue?")) return;
    try {
      await api("POST", "/admin/reseed");
      await refresh(); render(); closeAdmin();
      toast("Demo data reloaded");
    } catch(err) { toast(err.message, true); }
  };
  document.querySelectorAll(".admin-tab").forEach(b => { b.onclick = () => openAdmin(b.dataset.tab); });


  $("#btnPassword").onclick = () => {
    $("#pWarn").textContent = ""; $("#pCurrent").value = ""; $("#pNext").value = "";
    $("#pwd").classList.add("on");
  };
  $("#pwdScrim").onclick = () => $("#pwd").classList.remove("on");
  $("#btnPwdCancel").onclick = () => $("#pwd").classList.remove("on");
  $("#btnPwdSave").onclick = async () => {
    $("#pWarn").textContent = "";
    try {
      await api("POST", "/password", { current: $("#pCurrent").value, next: $("#pNext").value });
      $("#pwd").classList.remove("on");
      toast("Password changed");
    } catch (err) { $("#pWarn").textContent = err.message; }
  };

  $("#btnLogout").onclick = async () => {
    try { await api("POST", "/logout"); } catch (e) {}
    location.href = "/login";
  };

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal.on");
    if (open) open.classList.remove("on");
    else if ($("#sheet").classList.contains("on")) closeSheet();
  });
}

(async function init() {
  try {
    me = (await api("GET", "/me")).user;
  } catch (err) {
    location.href = "/login";
    return;
  }
  $("#meName").textContent = me.name;
  $("#meRole").textContent = (me.roles || [me.role]).join(", ");
  $("#btnAdd").hidden = !isManager();
  $("#btnAdmin").hidden = !isAdmin();

  reference = (await api("GET", "/reference"));
  reference.teams = reference.teams || [];
  reference.event_types = reference.event_types || [];
  // Explicit defaults — all filters open, past events hidden
  filters.q = ""; filters.state = ""; filters.sport = ""; filters.brand = ""; filters.past = false;
  fillSelects();
  wire();
  // Reset visible controls to match default filter state
  const qi = $("#q"); if (qi) qi.value = "";
  const fp = $("#fPast"); if (fp) fp.checked = false;
  await refresh();
  render();
})();

})();
