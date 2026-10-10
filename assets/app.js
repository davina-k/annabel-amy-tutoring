/* ==========================================================================
   Annabel and Amy's Maths Tutoring — front-end behaviour
   --------------------------------------------------------------------------
   Two jobs:
     1. Render the availability timetable (from Supabase, or example data).
     2. Take booking requests and enquiries (into Supabase, or via mailto).

   Everything degrades: if Supabase isn't configured or can't be reached,
   the page still works and still lets people get in touch.
   ========================================================================== */

const CFG = window.SITE_CONFIG || {};
const HAS_SUPABASE = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);

let supabase = null;
let liveMode = false;

/* --- Supabase client (loaded lazily so the page renders regardless) ------- */

async function initSupabase() {
  if (!HAS_SUPABASE) return null;
  try {
    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
    );
    return createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  } catch (err) {
    console.warn("Supabase client failed to load; falling back to preview mode.", err);
    return null;
  }
}

/* --- Dates --------------------------------------------------------------- */

const dayFmt  = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const fullFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false
});

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function relativeDay(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(date); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return dayFmt.format(date);
}

/* --- Slot sources -------------------------------------------------------- */

/** Example availability, used before Supabase is connected. */
function previewSlots() {
  const out = [];
  const now = new Date();
  const days = CFG.DAYS_AHEAD || 21;

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    for (const block of CFG.PREVIEW_AVAILABILITY || []) {
      if (block.day !== d.getDay()) continue;
      for (const t of block.times) {
        const [h, m] = t.split(":").map(Number);
        const start = new Date(d);
        start.setHours(h, m, 0, 0);
        if (start <= now) continue;
        out.push({
          id: `preview-${start.getTime()}-${block.tutor}`,
          starts_at: start,
          tutor: block.tutor,
          duration_minutes: 60,
          preview: true
        });
      }
    }
  }
  return out.sort((a, b) => a.starts_at - b.starts_at);
}

/** Live availability from Supabase. */
async function liveSlots() {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + (CFG.DAYS_AHEAD || 21));

  const { data, error } = await supabase
    .from("slots")
    .select("id, starts_at, duration_minutes, tutor, status")
    .eq("status", "available")
    .gt("starts_at", new Date().toISOString())
    .lt("starts_at", horizon.toISOString())
    .order("starts_at", { ascending: true })
    .limit(300);

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    starts_at: new Date(row.starts_at),
    tutor: row.tutor,
    duration_minutes: row.duration_minutes || 60,
    preview: false
  }));
}

/* --- Rendering ----------------------------------------------------------- */

const daysEl       = document.getElementById("days");
const statusEl     = document.getElementById("slots-status");
const statusTextEl = document.getElementById("slots-status-text");

let allSlots = [];
let tutorFilter = "all";
let expanded = false;

// How many days of the timetable to show before the "more dates" button.
const DAYS_VISIBLE = 8;

function setStatus(text, live) {
  statusTextEl.textContent = text;
  statusEl.classList.toggle("status--live", Boolean(live));
}

function render() {
  const slots = tutorFilter === "all"
    ? allSlots
    : allSlots.filter((s) => s.tutor === tutorFilter);

  daysEl.replaceChildren();

  if (!slots.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML =
      `<p>No free sessions showing for this selection right now. ` +
      `<a href="#contact">Send us a message</a> and we'll find you a time.</p>`;
    daysEl.append(empty);
    return;
  }

  // Group by calendar day, preserving chronological order.
  const groups = new Map();
  for (const slot of slots) {
    const key = dayKey(slot.starts_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  }

  const ordered = [...groups.values()];
  const shown = expanded ? ordered : ordered.slice(0, DAYS_VISIBLE);

  for (const group of shown) {
    const first = group[0].starts_at;

    const row = document.createElement("div");
    row.className = "day";

    const label = document.createElement("div");
    label.className = "day__label";
    label.innerHTML = `${relativeDay(first)}<span>${dateFmt.format(first)}</span>`;

    const list = document.createElement("div");
    list.className = "slots";

    for (const slot of group) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.dataset.id = slot.id;
      btn.innerHTML =
        `${timeFmt.format(slot.starts_at)}` +
        `<span class="slot__who">${slot.tutor}</span>`;
      btn.setAttribute(
        "aria-label",
        `Request ${fullFmt.format(slot.starts_at)} with ${slot.tutor}`
      );
      btn.addEventListener("click", () => openBooking(slot));
      list.append(btn);
    }

    row.append(label, list);
    daysEl.append(row);
  }

  const hidden = ordered.length - shown.length;
  if (hidden > 0 || expanded) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn btn--ghost more-dates";
    more.textContent = expanded
      ? "Show fewer dates"
      : `Show ${hidden} more ${hidden === 1 ? "date" : "dates"}`;
    more.addEventListener("click", () => {
      expanded = !expanded;
      render();
      if (!expanded) document.getElementById("availability").scrollIntoView({ block: "start" });
    });
    daysEl.append(more);
  }
}

async function loadSlots() {
  try {
    if (liveMode) {
      allSlots = await liveSlots();
      setStatus(`${allSlots.length} free ${allSlots.length === 1 ? "session" : "sessions"} in the next ${CFG.DAYS_AHEAD || 21} days`, true);
    } else {
      allSlots = previewSlots();
      setStatus("Showing example times — connect Supabase for live availability", false);
    }
  } catch (err) {
    console.warn("Could not load live availability; showing example times.", err);
    allSlots = previewSlots();
    setStatus("Live availability unavailable — showing example times", false);
  }
  render();
}

/* --- Tutor filter -------------------------------------------------------- */

document.querySelectorAll(".filter button").forEach((btn) => {
  btn.addEventListener("click", () => {
    tutorFilter = btn.dataset.tutor;
    document.querySelectorAll(".filter button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b === btn));
    });
    render();
  });
});

/* --- Booking dialog ------------------------------------------------------ */

const dialog     = document.getElementById("book-dialog");
const bookForm   = document.getElementById("book-form");
const bookWhen   = document.getElementById("book-when");
const bookMsg    = document.getElementById("book-msg");
const bookSubmit = document.getElementById("book-submit");

let activeSlot = null;

function showMsg(el, kind, text) {
  el.hidden = false;
  el.dataset.kind = kind;
  el.textContent = text;
}

function openBooking(slot) {
  activeSlot = slot;
  bookWhen.textContent = `${fullFmt.format(slot.starts_at)} · ${slot.duration_minutes} minutes · with ${slot.tutor}`;
  bookMsg.hidden = true;
  bookSubmit.disabled = false;
  bookSubmit.textContent = "Request session";
  bookForm.reset();
  dialog.showModal();
  document.getElementById("b-name").focus();
}

document.getElementById("book-close").addEventListener("click", () => dialog.close());

bookForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!bookForm.reportValidity()) return;

  const fd = Object.fromEntries(new FormData(bookForm).entries());
  bookSubmit.disabled = true;
  bookSubmit.textContent = "Sending…";

  // Preview mode, or Supabase unreachable: hand off to the visitor's email client
  // so an enquiry is never silently lost.
  if (!liveMode || activeSlot.preview) {
    const subject = `Session request: ${fullFmt.format(activeSlot.starts_at)} with ${activeSlot.tutor}`;
    const body = [
      `Requested slot: ${fullFmt.format(activeSlot.starts_at)} with ${activeSlot.tutor}`,
      ``,
      `Name: ${fd.name}`,
      `Email: ${fd.email}`,
      `Student: ${fd.student_name}`,
      `Level: ${fd.level}`,
      ``,
      fd.notes || ""
    ].join("\n");
    window.location.href =
      `mailto:${CFG.FALLBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    showMsg(bookMsg, "ok", "Opening your email app so you can send this request.");
    bookSubmit.disabled = false;
    bookSubmit.textContent = "Request session";
    return;
  }

  try {
    // `book_slot` is a SECURITY DEFINER function (see supabase/schema.sql).
    // It checks the slot is still free, records the booking and marks the slot
    // held — atomically, so two people can't take the same time.
    const { data, error } = await supabase.rpc("book_slot", {
      p_slot_id: activeSlot.id,
      p_contact_name: fd.name,
      p_contact_email: fd.email,
      p_student_name: fd.student_name,
      p_level: fd.level,
      p_notes: fd.notes || null
    });

    if (error) throw error;

    if (data && data.ok === false) {
      showMsg(bookMsg, "err", "Sorry — that slot was taken a moment ago. Please pick another time.");
      bookSubmit.disabled = false;
      bookSubmit.textContent = "Request session";
      await loadSlots();
      return;
    }

    showMsg(bookMsg, "ok", "Request received. We'll email you to confirm shortly.");
    bookSubmit.textContent = "Requested";
    await loadSlots();
  } catch (err) {
    console.error(err);
    showMsg(bookMsg, "err", "Something went wrong sending that. Please call or WhatsApp us on 07491 964646.");
    bookSubmit.disabled = false;
    bookSubmit.textContent = "Request session";
  }
});

/* --- Enquiry form -------------------------------------------------------- */

const enquiryForm = document.getElementById("enquiry-form");
const enquiryMsg  = document.getElementById("enquiry-msg");

enquiryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!enquiryForm.reportValidity()) return;

  const fd = Object.fromEntries(new FormData(enquiryForm).entries());
  const btn = enquiryForm.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Sending…";

  const restore = () => { btn.disabled = false; btn.textContent = "Send message"; };

  if (!liveMode) {
    const body = [
      `Name: ${fd.name}`,
      `Email: ${fd.email}`,
      `Phone: ${fd.phone || "—"}`,
      `Level: ${fd.level || "—"}`,
      ``,
      fd.message
    ].join("\n");
    window.location.href =
      `mailto:${CFG.FALLBACK_EMAIL}?subject=${encodeURIComponent("Tutoring enquiry from " + fd.name)}&body=${encodeURIComponent(body)}`;
    showMsg(enquiryMsg, "ok", "Opening your email app so you can send this message.");
    restore();
    return;
  }

  try {
    const { error } = await supabase.from("enquiries").insert({
      name: fd.name,
      email: fd.email,
      phone: fd.phone || null,
      level: fd.level || null,
      message: fd.message
    });
    if (error) throw error;
    showMsg(enquiryMsg, "ok", "Thanks — message received. We'll reply by email, usually the same day.");
    enquiryForm.reset();
    btn.textContent = "Sent";
  } catch (err) {
    console.error(err);
    showMsg(enquiryMsg, "err", "Something went wrong sending that. Please call or WhatsApp us on 07491 964646.");
    restore();
  }
});

/* --- Boot ---------------------------------------------------------------- */

document.getElementById("year").textContent = String(new Date().getFullYear());

(async () => {
  supabase = await initSupabase();
  liveMode = Boolean(supabase);
  await loadSlots();
})();
