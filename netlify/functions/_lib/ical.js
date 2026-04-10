/**
 * Pure .ics (iCalendar / RFC 5545) generation. No external dependencies.
 */

/**
 * Fold a content line to 75 octets per RFC 5545 section 3.1.
 */
function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let pos = 75;
  while (pos < line.length) {
    parts.push(" " + line.slice(pos, pos + 74));
    pos += 74;
  }
  return parts.join("\r\n");
}

/**
 * Escape text values per RFC 5545 section 3.3.11.
 */
function escapeText(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Generate a UID. Uses timestamp + random hex.
 */
function generateUID() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}@textboss`;
}

/**
 * Format a date string "YYYY-MM-DD" and time "HH:MM" into iCal DATETIME "YYYYMMDDTHHMMSS".
 */
function formatDateTime(dateStr, timeStr) {
  const d = dateStr.replace(/-/g, "");
  const [h, m] = (timeStr || "00:00").split(":");
  return `${d}T${h.padStart(2, "0")}${m.padStart(2, "0")}00`;
}

/**
 * Format duration in minutes to iCal DURATION value (e.g. "PT1H30M").
 */
function formatDuration(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  let dur = "PT";
  if (hrs > 0) dur += `${hrs}H`;
  if (mins > 0) dur += `${mins}M`;
  if (hrs === 0 && mins === 0) dur += "0M";
  return dur;
}

/**
 * Generate an RFC 5545 compliant VCALENDAR string.
 *
 * @param {Object} params
 * @param {string} params.title           - Event summary
 * @param {string} [params.description]   - Event description
 * @param {string} params.startDate       - "YYYY-MM-DD"
 * @param {string} params.startTime       - "HH:MM"
 * @param {number} params.durationMinutes - Duration in minutes
 * @param {string} [params.organizerName] - Organizer display name
 * @param {string} [params.organizerEmail]- Organizer email
 * @param {string} [params.attendeeName]  - Attendee display name
 * @param {string} [params.attendeeEmail] - Attendee email
 * @returns {string} VCALENDAR string
 */
function generateICS(params) {
  const {
    title,
    description,
    startDate,
    startTime,
    durationMinutes,
    organizerName,
    organizerEmail,
    attendeeName,
    attendeeEmail,
  } = params;

  const uid = generateUID();
  const now = new Date();
  const dtstamp =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") + "T" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") + "Z";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Text Boss//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${formatDateTime(startDate, startTime)}`,
    `DURATION:${formatDuration(durationMinutes)}`,
    `SUMMARY:${escapeText(title)}`,
  ];

  if (description) {
    lines.push(foldLine(`DESCRIPTION:${escapeText(description)}`));
  }

  if (organizerEmail) {
    const cn = organizerName ? `;CN=${escapeText(organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${organizerEmail}`);
  }

  if (attendeeEmail) {
    const cn = attendeeName ? `;CN=${escapeText(attendeeName)}` : "";
    lines.push(`ATTENDEE;RSVP=TRUE${cn}:mailto:${attendeeEmail}`);
  }

  lines.push("STATUS:CONFIRMED");
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

exports.generateICS = generateICS;
