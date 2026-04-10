const assert = require("node:assert/strict");

const { generateICS } = require("../netlify/functions/_lib/ical");

async function testBasicICSStructure() {
  const ics = generateICS({
    title: "Cut & Style",
    description: "Appointment with Jane Doe",
    startDate: "2026-04-15",
    startTime: "10:00",
    durationMinutes: 60,
    organizerName: "Mobile Hairdresser",
    organizerEmail: "owner@example.com",
    attendeeName: "Jane Doe",
    attendeeEmail: "jane@example.com",
  });

  assert.ok(ics.startsWith("BEGIN:VCALENDAR"), "should start with VCALENDAR");
  assert.ok(ics.includes("VERSION:2.0"), "should include VERSION");
  assert.ok(ics.includes("PRODID:-//Text Boss//Booking//EN"), "should include PRODID");
  assert.ok(ics.includes("BEGIN:VEVENT"), "should include VEVENT");
  assert.ok(ics.includes("END:VEVENT"), "should end VEVENT");
  assert.ok(ics.endsWith("END:VCALENDAR"), "should end with VCALENDAR");
  assert.ok(ics.includes("DTSTART:20260415T100000"), "should include correct DTSTART");
  assert.ok(ics.includes("DURATION:PT1H"), "should include correct duration");
  assert.ok(ics.includes("SUMMARY:Cut & Style"), "should include summary");
  assert.ok(ics.includes("DESCRIPTION:Appointment with Jane Doe"), "should include description");
  assert.ok(ics.includes("ORGANIZER"), "should include organizer");
  assert.ok(ics.includes("mailto:owner@example.com"), "should include organizer email");
  assert.ok(ics.includes("ATTENDEE"), "should include attendee");
  assert.ok(ics.includes("mailto:jane@example.com"), "should include attendee email");
  assert.ok(ics.includes("STATUS:CONFIRMED"), "should include status");
  assert.ok(ics.includes("UID:"), "should include UID");
  assert.ok(ics.includes("DTSTAMP:"), "should include DTSTAMP");
}

async function testMinimalICS() {
  const ics = generateICS({
    title: "Consultation",
    startDate: "2026-12-25",
    startTime: "14:30",
    durationMinutes: 30,
  });

  assert.ok(ics.includes("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("DTSTART:20261225T143000"));
  assert.ok(ics.includes("DURATION:PT30M"));
  assert.ok(ics.includes("SUMMARY:Consultation"));
  assert.ok(!ics.includes("ORGANIZER"), "should not include organizer when not provided");
  assert.ok(!ics.includes("ATTENDEE"), "should not include attendee when not provided");
  assert.ok(!ics.includes("DESCRIPTION"), "should not include description when not provided");
}

async function testDurationFormatting() {
  // 90 minutes = 1h30m
  const ics90 = generateICS({
    title: "Long session",
    startDate: "2026-01-01",
    startTime: "09:00",
    durationMinutes: 90,
  });
  assert.ok(ics90.includes("DURATION:PT1H30M"), "90 min should be PT1H30M");

  // 120 minutes = 2h
  const ics120 = generateICS({
    title: "Two hours",
    startDate: "2026-01-01",
    startTime: "09:00",
    durationMinutes: 120,
  });
  assert.ok(ics120.includes("DURATION:PT2H"), "120 min should be PT2H");

  // 45 minutes
  const ics45 = generateICS({
    title: "Quick session",
    startDate: "2026-01-01",
    startTime: "09:00",
    durationMinutes: 45,
  });
  assert.ok(ics45.includes("DURATION:PT45M"), "45 min should be PT45M");
}

async function testSpecialCharacterEscaping() {
  const ics = generateICS({
    title: "Cut, Colour; Style",
    description: "Line one\nLine two",
    startDate: "2026-01-01",
    startTime: "09:00",
    durationMinutes: 60,
  });

  assert.ok(ics.includes("SUMMARY:Cut\\, Colour\\; Style"), "should escape commas and semicolons");
  assert.ok(ics.includes("Line one\\nLine two"), "should escape newlines");
}

async function testCRLFLineEndings() {
  const ics = generateICS({
    title: "Test",
    startDate: "2026-01-01",
    startTime: "09:00",
    durationMinutes: 60,
  });

  const lines = ics.split("\r\n");
  assert.ok(lines.length > 5, "should have multiple CRLF-delimited lines");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
}

async function run() {
  await testBasicICSStructure();
  await testMinimalICS();
  await testDurationFormatting();
  await testSpecialCharacterEscaping();
  await testCRLFLineEndings();
  console.log("ical tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
