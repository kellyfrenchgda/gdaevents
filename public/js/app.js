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
  const isGen = ev.type === "general";
  const past = isPast(ev);
  const line2 = isGen
    ? esc(ev.venue || "Venue TBC")
    : esc([ev.opponent ? "v " + ev.opponent : "", ev.venue].filter(Boolean).join(" · "));

  return (
    '<button class="event' + (past ? " past" : "") + '" data-id="' + ev.id +
      '" style="--keel:' + brandColour(ev.brand) + ";animation-delay:" + Math.min(i * 32, 320) + 'ms">' +
      '<div class="event-top">' +
        '<span class="time">' + esc(fmtTime(ev.start)) + "</span>" +
        '<span class="tag state">' + esc(ev.state || "—") + "</span>" +
        (isGen ? '<span class="tag general">General event</span>'
               : '<span class="tag">' + esc(ev.sport || "Sport TBC") + "</span>") +
        (past ? '<span class="tag">Past</span>' : "") +
      "</div>" +
      '<div class="title">' + esc(isGen ? ev.name : ev.team || ev.name) + "</div>" +
      '<div class="sub">' + (isGen ? line2 : esc(ev.name) + (line2 ? " · " + line2 : "")) + "</div>" +
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
  const isGen = ev.type === "general";

  $("#sheetHead").style.setProperty("--keel", brandColour(ev.brand));
  $("#sheetWhen").textContent = parts.full + " · " + fmtTime(ev.start);
  $("#sheetTitle").textContent = isGen ? ev.name : ev.team || ev.name;

  const rows = [
    ["Start", parts.full + ", " + fmtTime(ev.start)],
    ["State", ev.state || "—"],
    ["Sport", isGen ? "General event" : ev.sport || "—"],
    ["Team", isGen ? "—" : ev.team || "—"],
    ["Fixture", isGen ? ev.name : ev.opponent ? ev.team + " v " + ev.opponent : ev.name],
    ["Venue", ev.venue || "—"]
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

  $("#sheetFoot").hidden = !isManager();
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

function setFormType(t) {
  formType = t;
  document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.type === t));
  document.querySelectorAll(".sponsonly").forEach((el) => { el.style.display = t === "general" ? "none" : ""; });
  $("#lblName").textContent = t === "general" ? "Event name" : "Fixture or event name";
}

function openForm(id) {
  editingId = id;
  const ev = id ? events.find((e) => e.id === id) : null;
  $("#modalTitle").textContent = ev ? "Edit event" : "Add event";
  setFormType(ev ? ev.type || "sponsorship" : "sponsorship");
  $("#mWarn").textContent = "";

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
    const payload = {
      name: $("#mName").value.trim(),
      type: formType,
      start: ($("#mDate").value || "") + "T" + ($("#mTime").value || "00:00"),
      state: $("#mState").value,
      venue: $("#mVenue").value.trim(),
      brand: $("#mBrand").value,
      capacity: Number($("#mCap").value) || 0,
      notes: $("#mNotes").value.trim(),
      sport: formType === "general" ? "" : $("#mSport").value,
      team: formType === "general" ? "" : $("#mTeam").value.trim(),
      opponent: formType === "general" ? "" : $("#mOpp").value.trim()
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

/* ---------------- people ---------------- */

async function openPeople() {
  $("#people").classList.add("on");
  $("#uWarn").textContent = "";
  await drawPeople();
}

async function drawPeople() {
  try {
    const { users } = await api("GET", "/users");
    $("#peopleList").innerHTML = users.map((u) =>
      '<div class="person">' +
        '<div class="who"><div class="n">' + esc(u.name) + "</div>" +
        '<div class="o">' + esc(u.email) + "</div></div>" +
        + (u.roles || [u.role]).map(r =>
          '<span class="pill ' + (r === "admin" ? "confirmed" : r === "manager" ? "pending" : "") + '" style="margin-right:3px">' + esc(r) + '</span>'
        ).join("") +
        (u.id === me.id ? "" : '<button class="rm" data-del="' + u.id + '" aria-label="Remove ' + esc(u.name) + '">✕</button>') +
      "</div>").join("");
    $("#peopleList").querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("Remove this person's access?")) return;
        try { await api("DELETE", "/users/" + b.dataset.del); await drawPeople(); toast("Access removed"); }
        catch (err) { toast(err.message, true); }
      };
    });
  } catch (err) {
    $("#peopleList").innerHTML = '<p class="warn">' + esc(err.message) + "</p>";
  }
}

async function addUser() {
  const warn = $("#uWarn");
  warn.textContent = "";
  try {
    await api("POST", "/users", {
      name: $("#uName").value.trim(),
      email: $("#uEmail").value.trim(),
      password: $("#uPass").value,
      role: $("#uRole").value
    });
    $("#uName").value = ""; $("#uEmail").value = ""; $("#uPass").value = "";
    await drawPeople();
    toast("Person added");
  } catch (err) {
    warn.textContent = err.message;
  }
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
  const add = (sel, arr) => arr.forEach((v) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
  add($("#fState"), reference.states); add($("#fSport"), reference.sports); add($("#fBrand"), reference.brands);
  add($("#mState"), reference.states); add($("#mSport"), reference.sports); add($("#mBrand"), reference.brands);
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
  $("#btnEdit").onclick = () => openForm(selectedId);
  $("#btnDelete").onclick = deleteEvent;
  $("#btnCancel").onclick = closeForm;
  $("#modalScrim").onclick = closeForm;
  $("#btnSave").onclick = saveForm;
  document.querySelectorAll("#typeSeg button").forEach((b) => { b.onclick = () => setFormType(b.dataset.type); });

  $("#btnPeople").onclick = openPeople;
  $("#peopleScrim").onclick = () => $("#people").classList.remove("on");
  $("#btnPeopleClose").onclick = () => $("#people").classList.remove("on");
  $("#btnAddUser").onclick = addUser;

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
  $("#btnPeople").hidden = !isAdmin();

  reference = (await api("GET", "/reference"));
  fillSelects();
  wire();
  await refresh();
  render();
})();

})();
