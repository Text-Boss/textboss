/**
 * ical-import.js — POST /.netlify/functions/ical-import
 *
 * Accepts the raw text content of an .ics file, parses VEVENT entries,
 * and stores upcoming events as busy_blocks in Supabase.
 *
 * Tier limits:
 *   Pro:   60-day import window, 200 total busy blocks
 *   Black: 90-day import window, 500 total busy blocks
 *
 * Returns: { ok, imported, skipped, batch_id }
 * The batch_id lets the client offer an "Undo this import" action.
 *
 * No external npm packages — ICS is parsed inline using a minimal RFC 5545
 * implementation that handles the output of Google Calendar, Apple Calendar,
 * and Outlook exports.
 */

const crypto = require("crypto");
const { createBusyBlockStore, createEntitlementStore } = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");
const { json, denied } = require("./_lib/http");

const SCHEDULING_TIERS = new Set(["Pro", "Black"]);
const IMPORT_WINDOW_DAYS = { Pro: 60, Black: 90 };
const BLOCK_LIMITS       = { Pro: 200, Black: 500 };
const MAX_ICS_BYTES      = 800 * 1024; // 800 KB

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

// ── ICS parser ───────────────────────────────────────────────────────────────

/**
 * Unfold RFC 5545 line continuations (a CRLF/LF followed by a SPACE or TAB).
 */
function unfoldLines(text) {
  return String(text || "").replace(/\r?\n[ \t]/g, "");
}

/**
 * Unescape ICS text property values.
 */
function unescapeICS(str) {
  return String(str || "")
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parse an ICS date/date-time value (everything after the colon on a
 * DTSTART or DTEND line) into { date, time, allDay }.
 *
 * Handles:
 *   YYYYMMDD              — all-day
 *   YYYYMMDDTHHmmss       — local time
 *   YYYYMMDDTHHmmssZ     — UTC (treated as local for simplicity; no TZ conversion)
 */
function parseICSDate(raw) {
  if (!raw) return null;
  // Strip trailing Z and any leading/trailing whitespace
  const s = String(raw).trim().replace(/Z$/i, "");
  // Extract only digits (and T separator)
  const clean = s.replace(/[^0-9T]/g, "");

  if (clean.length === 8) {
    // All-day: YYYYMMDD
    return {
      date: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
      time: null,
      allDay: true,
    };
  }

  const tIdx = clean.indexOf("T");
  if (tIdx === 8 && clean.length >= 13) {
    return {
      date: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
      time: `${clean.slice(9, 11)}:${clean.slice(11, 13)}`,
      allDay: false,
    };
  }

  return null;
}

/**
 * Parse an ISO 8601 duration string (e.g. PT1H30M, P1D) into minutes.
 */
function parseDurationMinutes(dur) {
  if (!dur) return 60;
  const m = String(dur).match(
    /P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/
  );
  if (!m) return 60;
  return (
    (parseInt(m[1] || 0) * 7 * 24 * 60) +
    (parseInt(m[2] || 0) * 24 * 60) +
    (parseInt(m[3] || 0) * 60) +
    parseInt(m[4] || 0)
  );
}

/**
 * Add minutes to an HH:MM string, clamping at 23:59.
 */
function addMinutesToTime(timeStr, minutes) {
  const [h, m] = String(timeStr || "00:00").split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Add n days to a YYYY-MM-DD string.
 */
function addDays(dateStr, n) {
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(y, mo - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Parse an ICS text into an array of raw VEVENT objects.
 */
function parseICS(text) {
  const unfolded = unfoldLines(text);
  const lines    = unfolded.split(/\r?\n/);
  const events   = [];
  let current    = null;

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    // Property name is before first ';' (strips TZID=... params)
    const propName = line.slice(0, colonIdx).split(";")[0].toUpperCase().trim();
    const value    = line.slice(colonIdx + 1);

    if (propName === "BEGIN" && value.trim() === "VEVENT") {
      current = {};
    } else if (propName === "END" && value.trim() === "VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current !== null) {
      switch (propName) {
        case "DTSTART":  current.dtstart  = value.trim(); break;
        case "DTEND":    current.dtend    = value.trim(); break;
        case "DURATION": current.duration = value.trim(); break;
        case "SUMMARY":  current.summary  = unescapeICS(value); break;
        case "STATUS":   current.status   = value.trim().toUpperCase(); break;
        case "UID":      current.uid      = value.trim(); break;
      }
    }
  }

  return events;
}

/**
 * Convert parsed VEVENT objects into busy_block rows, filtered to the given
 * date window. Deduplicates within this import batch.
 */
function eventsToBusyBlocks(events, windowStart, windowEnd, importBatch) {
  const blocks = [];
  const seen   = new Set();

  for (const ev of events) {
    if (ev.status === "CANCELLED") continue;
    if (!ev.dtstart) continue;

    const start = parseICSDate(ev.dtstart);
    if (!start) continue;

    // Filter to window
    if (start.date < windowStart || start.date > windowEnd) continue;

    let blockStart, blockEnd;

    if (start.allDay) {
      // All-day events block the whole day
      blockStart = "00:00";
      blockEnd   = "23:59";
    } else {
      blockStart = start.time;

      if (ev.dtend) {
        const end = parseICSDate(ev.dtend);
        if (end && !end.allDay && end.date === start.date) {
          blockEnd = end.time;
        } else {
          // Ends next day or unparseable — block to end of day
          blockEnd = "23:59";
        }
      } else if (ev.duration) {
        const mins = parseDurationMinutes(ev.duration);
        blockEnd = addMinutesToTime(blockStart, mins);
      } else {
        // Fallback: 1-hour block
        blockEnd = addMinutesToTime(blockStart, 60);
      }

      // Skip zero-length or inverted blocks
      if (blockEnd <= blockStart) continue;
    }

    // Deduplicate within this upload
    const key = `${start.date}|${blockStart}|${blockEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);

    blocks.push({
      block_date:   start.date,
      start_time:   blockStart,
      end_time:     blockEnd,
      label:        ev.summary ? ev.summary.slice(0, 120) : null,
      source:       "ical_import",
      import_batch: importBatch,
    });
  }

  return blocks;
}

// ── Handler ──────────────────────────────────────────────────────────────────

function createHandler(deps) {
  const { verifySessionCookie, findEntitlementByEmail, busyBlockStore } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, reason: "method_not_allowed" });
    }

    // Auth
    let verification;
    try { verification = verifySessionCookie(event.headers || {}); }
    catch { return denied(401, "missing_session"); }
    if (!verification.ok) return denied(401, verification.reason);

    const session = verification.session;

    const entitlement = await findEntitlementByEmail(session.email);
    if (!entitlement) return denied(403, "not_found");

    const status = normalizeStatus(entitlement.subscription_status);
    if (status !== "active" && status !== "trialing") return denied(403, "not_active");

    const tier = normalizeTier(entitlement.entitled_tier);
    if (!SCHEDULING_TIERS.has(tier)) return denied(403, "tier_not_entitled");

    // Parse request body — client sends { icsContent: "..." }
    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return json(400, { ok: false, reason: "invalid_json" }); }

    const icsContent = String(body.icsContent || "").trim();
    if (!icsContent) return json(400, { ok: false, reason: "missing_ics_content" });
    if (Buffer.byteLength(icsContent, "utf8") > MAX_ICS_BYTES) {
      return json(400, { ok: false, reason: "file_too_large" });
    }

    if (!icsContent.includes("BEGIN:VCALENDAR")) {
      return json(400, { ok: false, reason: "invalid_ics_format" });
    }

    // Determine window
    const windowDays  = IMPORT_WINDOW_DAYS[tier] || 60;
    const today       = new Date().toISOString().split("T")[0];
    const windowEnd   = addDays(today, windowDays);

    // Parse ICS
    const events   = parseICS(icsContent);
    const batchId  = crypto.randomUUID();
    const blocks   = eventsToBusyBlocks(events, today, windowEnd, batchId);

    if (blocks.length === 0) {
      return json(200, { ok: true, imported: 0, skipped: events.length, batch_id: null });
    }

    // Enforce tier limit
    const limit = BLOCK_LIMITS[tier] || 200;
    const existing = await busyBlockStore.countBusyBlocks(session.email);
    const available = limit - existing;
    const toInsert  = blocks.slice(0, Math.max(0, available));
    const skipped   = events.length - toInsert.length;

    if (toInsert.length === 0) {
      return json(400, { ok: false, reason: "block_limit_reached", limit });
    }

    await busyBlockStore.createBusyBlocks(session.email, toInsert);

    return json(200, {
      ok:        true,
      imported:  toInsert.length,
      skipped,
      batch_id:  batchId,
    });
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore = overrides.entitlementStore || createEntitlementStore();
  const busyBlockStore   = overrides.busyBlockStore   || createBusyBlockStore();
  const runtimeSessionLib = overrides.sessionLib      || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    busyBlockStore,
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    return json(500, { ok: false, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
