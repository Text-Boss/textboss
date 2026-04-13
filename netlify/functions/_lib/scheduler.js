/**
 * Scheduling helper: computes available time slots by subtracting
 * existing appointments (plus buffer) from working-hours windows.
 *
 * Pure logic — no Supabase, no OpenAI. Accepts data, returns data.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Parse "HH:MM" into minutes since midnight.
 */
function parseTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Format minutes since midnight back to "HH:MM".
 */
function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Generate all dates in [startDate, endDate] inclusive.
 * Dates are "YYYY-MM-DD" strings.
 * Returns array of { date: "YYYY-MM-DD", dayOfWeek: 0-6, dayName: "Monday" }.
 */
function dateRange(startDate, endDate) {
  const results = [];
  const start = parseDateToLocal(startDate);
  const end = parseDateToLocal(endDate);

  // Safety: cap at 60 days to prevent runaway loops
  const maxDays = 60;
  let count = 0;

  const current = new Date(start);
  while (current <= end && count < maxDays) {
    const y = current.getFullYear();
    const mo = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    const dow = current.getDay();
    results.push({
      date: `${y}-${mo}-${d}`,
      dayOfWeek: dow,
      dayName: DAYS[dow],
    });
    current.setDate(current.getDate() + 1);
    count++;
  }
  return results;
}

/**
 * Parse "YYYY-MM-DD" into a local Date (midnight).
 */
function parseDateToLocal(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Find available time slots across a date range.
 *
 * @param {Object} params
 * @param {string} params.startDate        - "YYYY-MM-DD" inclusive start
 * @param {string} params.endDate          - "YYYY-MM-DD" inclusive end
 * @param {number} params.durationMinutes  - required slot duration
 * @param {number} params.preBuffer        - minutes of buffer before each appointment (default 0)
 * @param {number} params.postBuffer       - minutes of buffer after each appointment (default 0)
 * @param {Array}  params.appointments     - existing confirmed appointments
 *   Each: { scheduled_date, scheduled_time, duration_minutes }
 * @param {Array}  params.busyBlocks       - one-off non-bookable time ranges (optional)
 *   Each: { block_date: "YYYY-MM-DD", start_time: "HH:MM", end_time: "HH:MM" }
 *   Subtracted from availability with no additional buffer.
 * @param {Array}  params.workingHours     - weekly working-hours envelope (optional)
 *   Each: { day_of_week: 0-6, start_time: "HH:MM", end_time: "HH:MM" }
 *   If empty/missing, defaults to Mon-Fri 09:00-17:00.
 * @param {number} [params.maxSlotsPerDay=5] - cap returned slots per day
 *
 * @returns {Array} available slots:
 *   [{ date, dayName, startTime, endTime, durationMinutes }]
 */
function findAvailableSlots(params) {
  const {
    startDate,
    endDate,
    durationMinutes,
    preBuffer = 0,
    postBuffer = 0,
    appointments = [],
    busyBlocks = [],
    workingHours = [],
    maxSlotsPerDay = 5,
  } = params;

  if (!startDate || !endDate || !durationMinutes) {
    return [];
  }

  // Build working-hours lookup: dayOfWeek -> [{ start, end }] in minutes
  const whLookup = {};
  const effectiveWH = workingHours.length > 0
    ? workingHours
    : [
        { day_of_week: 1, start_time: "09:00", end_time: "17:00" },
        { day_of_week: 2, start_time: "09:00", end_time: "17:00" },
        { day_of_week: 3, start_time: "09:00", end_time: "17:00" },
        { day_of_week: 4, start_time: "09:00", end_time: "17:00" },
        { day_of_week: 5, start_time: "09:00", end_time: "17:00" },
      ];

  for (const wh of effectiveWH) {
    const dow = wh.day_of_week;
    if (!whLookup[dow]) whLookup[dow] = [];
    whLookup[dow].push({
      start: parseTime(wh.start_time),
      end: parseTime(wh.end_time),
    });
  }

  // Index appointments by date for fast lookup
  const apptsByDate = {};
  for (const appt of appointments) {
    if (appt.status && appt.status !== "confirmed") continue;
    const d = appt.scheduled_date;
    if (!apptsByDate[d]) apptsByDate[d] = [];
    const apptStart = parseTime(appt.scheduled_time);
    const apptDuration = appt.duration_minutes || 60;
    apptsByDate[d].push({
      // Block includes pre-buffer before and post-buffer after
      blockStart: apptStart - preBuffer,
      blockEnd: apptStart + apptDuration + postBuffer,
    });
  }

  // Index busy blocks by date — exact range, no buffer applied
  for (const block of busyBlocks) {
    const d = String(block.block_date || "");
    if (!d) continue;
    if (!apptsByDate[d]) apptsByDate[d] = [];
    const bs = parseTime(block.start_time);
    const be = parseTime(block.end_time);
    if (be > bs) {
      apptsByDate[d].push({ blockStart: bs, blockEnd: be });
    }
  }

  // Sort blocked ranges per date
  for (const d of Object.keys(apptsByDate)) {
    apptsByDate[d].sort((a, b) => a.blockStart - b.blockStart);
  }

  const results = [];
  const dates = dateRange(startDate, endDate);

  for (const { date, dayOfWeek, dayName } of dates) {
    const windows = whLookup[dayOfWeek];
    if (!windows || windows.length === 0) continue;

    const blocked = apptsByDate[date] || [];
    let daySlots = 0;

    for (const window of windows) {
      // Find gaps in this working-hours window
      let cursor = window.start;

      for (const block of blocked) {
        // Skip blocks entirely before cursor or after window
        if (block.blockEnd <= cursor) continue;
        if (block.blockStart >= window.end) break;

        // Gap before this block
        const gapEnd = Math.min(block.blockStart, window.end);
        if (gapEnd - cursor >= durationMinutes && daySlots < maxSlotsPerDay) {
          // Emit slots at 30-minute intervals within this gap
          let slotStart = cursor;
          while (slotStart + durationMinutes <= gapEnd && daySlots < maxSlotsPerDay) {
            results.push({
              date,
              dayName,
              startTime: formatTime(slotStart),
              endTime: formatTime(slotStart + durationMinutes),
              durationMinutes,
            });
            daySlots++;
            slotStart += 30;
          }
        }

        cursor = Math.max(cursor, block.blockEnd);
      }

      // Gap after last block until end of window
      if (cursor < window.end && window.end - cursor >= durationMinutes && daySlots < maxSlotsPerDay) {
        let slotStart = cursor;
        while (slotStart + durationMinutes <= window.end && daySlots < maxSlotsPerDay) {
          results.push({
            date,
            dayName,
            startTime: formatTime(slotStart),
            endTime: formatTime(slotStart + durationMinutes),
            durationMinutes,
          });
          daySlots++;
          slotStart += 30;
        }
      }
    }
  }

  return results;
}

/**
 * Format a business profile into a text block for the system prompt.
 */
function formatBusinessProfile(profile) {
  if (!profile) return "";

  const lines = ["=== BUSINESS PROFILE ==="];

  if (profile.occupation) {
    lines.push(`Occupation: ${profile.occupation}`);
  }

  const pre  = profile.buffer_before_minutes ?? profile.pre_buffer_minutes  ?? 0;
  const post = profile.buffer_after_minutes  ?? profile.post_buffer_minutes ?? 0;
  if (pre || post) {
    lines.push(`Default buffer: ${pre} min before, ${post} min after each appointment`);
  }

  if (Array.isArray(profile.services) && profile.services.length > 0) {
    lines.push("\nServices:");
    for (const svc of profile.services) {
      const parts = [`- ${svc.name}`];
      if (svc.duration_minutes) parts.push(`(${svc.duration_minutes} min)`);
      if (svc.description) parts.push(`— ${svc.description}`);
      lines.push(parts.join(" "));
    }
  }

  return lines.join("\n");
}

/**
 * Format available slots into a text block for the system prompt context.
 */
function formatAvailableSlots(slots) {
  if (!slots || slots.length === 0) {
    return "=== AVAILABLE SLOTS ===\nNo available slots found for the requested timeframe.";
  }

  const lines = ["=== AVAILABLE SLOTS ==="];

  let currentDate = null;
  for (const slot of slots) {
    if (slot.date !== currentDate) {
      currentDate = slot.date;
      lines.push(`\n${slot.dayName}, ${slot.date}:`);
    }
    lines.push(`  ${slot.startTime} – ${slot.endTime} (${slot.durationMinutes} min)`);
  }

  return lines.join("\n");
}

/**
 * Format existing appointments into a text block for context.
 */
function formatAppointments(appointments) {
  const lines = ["=== EXISTING APPOINTMENTS ==="];

  if (!appointments || appointments.length === 0) {
    lines.push("No upcoming appointments.");
    return lines.join("\n");
  }

  for (const appt of appointments) {
    const dateParts = appt.scheduled_date ? appt.scheduled_date.split("-") : [];
    let dayLabel = "";
    if (dateParts.length === 3) {
      const d = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));
      dayLabel = ` (${DAYS[d.getDay()]})`;
    }
    const parts = [
      `[id:${appt.id}]`,
      `${appt.scheduled_date}${dayLabel} at ${appt.scheduled_time}`,
      `${appt.duration_minutes || 60} min`,
    ];
    if (appt.client_name)    parts.push(appt.client_name);
    if (appt.client_contact) parts.push(appt.client_contact);
    if (appt.title)          parts.push(appt.title);
    if (appt.status && appt.status !== "confirmed") parts.push(`[${appt.status}]`);
    lines.push(`- ${parts.join(" | ")}`);
  }

  return lines.join("\n");
}

/**
 * Convert business_profiles.working_hours JSON object format to the array
 * format expected by findAvailableSlots.
 *
 * Input:  { "1": { start: "09:00", end: "18:00" }, "5": { ... } }
 * Output: [ { day_of_week: 1, start_time: "09:00", end_time: "18:00" }, ... ]
 */
function workingHoursToArray(workingHours) {
  if (!workingHours || typeof workingHours !== "object" || Array.isArray(workingHours)) {
    return [];
  }
  return Object.entries(workingHours).map(([dow, times]) => ({
    day_of_week: parseInt(dow, 10),
    start_time:  times.start,
    end_time:    times.end,
  }));
}

exports.findAvailableSlots    = findAvailableSlots;
exports.formatBusinessProfile = formatBusinessProfile;
exports.formatAvailableSlots  = formatAvailableSlots;
exports.formatAppointments    = formatAppointments;
exports.workingHoursToArray   = workingHoursToArray;
exports.parseTime             = parseTime;
exports.formatTime            = formatTime;
exports.dateRange             = dateRange;
