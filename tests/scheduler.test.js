const assert = require("node:assert/strict");

const {
  findAvailableSlots,
  formatBusinessProfile,
  formatAvailableSlots,
  formatAppointments,
  workingHoursToArray,
  parseTime,
  formatTime,
  dateRange,
} = require("../netlify/functions/_lib/scheduler");

// ── parseTime / formatTime ──────────────────────────────────────────────────

async function testParseTime() {
  assert.equal(parseTime("09:00"), 540);
  assert.equal(parseTime("00:00"), 0);
  assert.equal(parseTime("23:59"), 1439);
  assert.equal(parseTime("12:30"), 750);
}

async function testFormatTime() {
  assert.equal(formatTime(540), "09:00");
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(1439), "23:59");
  assert.equal(formatTime(750), "12:30");
}

// ── dateRange ───────────────────────────────────────────────────────────────

async function testDateRangeSingleDay() {
  const dates = dateRange("2026-04-13", "2026-04-13");
  assert.equal(dates.length, 1);
  assert.equal(dates[0].date, "2026-04-13");
  assert.equal(dates[0].dayName, "Monday");
}

async function testDateRangeMultipleDays() {
  const dates = dateRange("2026-04-13", "2026-04-15");
  assert.equal(dates.length, 3);
  assert.equal(dates[0].date, "2026-04-13");
  assert.equal(dates[1].date, "2026-04-14");
  assert.equal(dates[2].date, "2026-04-15");
}

async function testDateRangeCappedAt60Days() {
  const dates = dateRange("2026-01-01", "2026-12-31");
  assert.equal(dates.length, 60);
}

// ── findAvailableSlots: basic cases ─────────────────────────────────────────

async function testEmptyCalendarDefaultWorkingHours() {
  // Monday, no appointments, default Mon-Fri 9-17
  const slots = findAvailableSlots({
    startDate: "2026-04-13",
    endDate: "2026-04-13",
    durationMinutes: 60,
    appointments: [],
  });

  assert.ok(slots.length > 0, "should find slots on an empty Monday");
  assert.equal(slots[0].date, "2026-04-13");
  assert.equal(slots[0].startTime, "09:00");
  assert.equal(slots[0].durationMinutes, 60);
}

async function testNoSlotsOnWeekendWithDefaults() {
  // Saturday 2026-04-18 — default working hours are Mon-Fri
  const slots = findAvailableSlots({
    startDate: "2026-04-18",
    endDate: "2026-04-18",
    durationMinutes: 60,
    appointments: [],
  });

  assert.equal(slots.length, 0, "should have no slots on Saturday with default hours");
}

async function testAppointmentBlocksSlot() {
  // Monday 9am-5pm, one appointment at 10:00 for 60 min
  const slots = findAvailableSlots({
    startDate: "2026-04-13",
    endDate: "2026-04-13",
    durationMinutes: 60,
    appointments: [
      { scheduled_date: "2026-04-13", scheduled_time: "10:00", duration_minutes: 60, status: "confirmed" },
    ],
  });

  // 9:00 should be available, 10:00 should not
  const slotTimes = slots.map(s => s.startTime);
  assert.ok(slotTimes.includes("09:00"), "9am should be available");
  assert.ok(!slotTimes.includes("10:00"), "10am should be blocked");
}

async function testBufferTimesBlockAdjacentSlots() {
  // 15 min pre-buffer and 15 min post-buffer around a 10:00-11:00 appt
  // should block 9:45-11:15
  const slots = findAvailableSlots({
    startDate: "2026-04-13",
    endDate: "2026-04-13",
    durationMinutes: 30,
    preBuffer: 15,
    postBuffer: 15,
    appointments: [
      { scheduled_date: "2026-04-13", scheduled_time: "10:00", duration_minutes: 60, status: "confirmed" },
    ],
  });

  const slotTimes = slots.map(s => s.startTime);
  // 9:30 starts at 9:30, ends at 10:00 — but the block starts at 9:45 (10:00 - 15 pre-buffer)
  // So 9:30-10:00 would overlap with the blocked range starting at 9:45
  // The gap before is 9:00-9:45, which fits a 30-min slot at 9:00
  assert.ok(slotTimes.includes("09:00"), "9:00 should be available (before buffer)");
  // 9:30 slot would be 9:30-10:00 but block starts at 9:45, so gap is only 9:00-9:45
  // 9:30 + 30 = 10:00 > 9:45, so 9:30 should NOT be available
  assert.ok(!slotTimes.includes("09:30"), "9:30 should be blocked by pre-buffer");

  // After the appointment: block ends at 11:15 (11:00 + 15 post-buffer)
  // Next available slot starts at 11:15 (first 30-min slot that fits after the block)
  assert.ok(!slotTimes.includes("11:00"), "11:00 should be blocked by post-buffer");
  assert.ok(slotTimes.includes("11:15"), "11:15 should be available (after buffer ends at 11:15)");
}

async function testCancelledAppointmentsIgnored() {
  const slots = findAvailableSlots({
    startDate: "2026-04-13",
    endDate: "2026-04-13",
    durationMinutes: 60,
    appointments: [
      { scheduled_date: "2026-04-13", scheduled_time: "10:00", duration_minutes: 60, status: "cancelled" },
    ],
  });

  const slotTimes = slots.map(s => s.startTime);
  assert.ok(slotTimes.includes("10:00"), "10:00 should be available since appointment is cancelled");
}

async function testCustomWorkingHours() {
  // Saturday with custom working hours
  const slots = findAvailableSlots({
    startDate: "2026-04-18",
    endDate: "2026-04-18",
    durationMinutes: 60,
    appointments: [],
    workingHours: [
      { day_of_week: 6, start_time: "10:00", end_time: "14:00" },
    ],
  });

  assert.ok(slots.length > 0, "should have slots on Saturday with custom hours");
  assert.equal(slots[0].startTime, "10:00");
  // Last slot should end by 14:00
  const lastSlot = slots[slots.length - 1];
  const endMinutes = parseTime(lastSlot.endTime);
  assert.ok(endMinutes <= parseTime("14:00"), "slots should not exceed working hours");
}

async function testMaxSlotsPerDayCap() {
  const slots = findAvailableSlots({
    startDate: "2026-04-13",
    endDate: "2026-04-13",
    durationMinutes: 30,
    appointments: [],
    maxSlotsPerDay: 3,
  });

  assert.equal(slots.length, 3, "should respect maxSlotsPerDay cap");
}

async function testMultipleDaysReturnSlots() {
  const slots = findAvailableSlots({
    startDate: "2026-04-13",
    endDate: "2026-04-14",
    durationMinutes: 60,
    appointments: [],
    maxSlotsPerDay: 2,
  });

  const mondaySlots = slots.filter(s => s.date === "2026-04-13");
  const tuesdaySlots = slots.filter(s => s.date === "2026-04-14");
  assert.equal(mondaySlots.length, 2);
  assert.equal(tuesdaySlots.length, 2);
}

async function testMissingParamsReturnsEmpty() {
  assert.deepEqual(findAvailableSlots({}), []);
  assert.deepEqual(findAvailableSlots({ startDate: "2026-04-13" }), []);
  assert.deepEqual(findAvailableSlots({ startDate: "2026-04-13", endDate: "2026-04-13" }), []);
}

// ── formatBusinessProfile ───────────────────────────────────────────────────

async function testFormatBusinessProfileFull() {
  const text = formatBusinessProfile({
    occupation: "Hair Stylist",
    pre_buffer_minutes: 10,
    post_buffer_minutes: 15,
    services: [
      { name: "Haircut", duration_minutes: 45, description: "Standard cut" },
      { name: "Color", duration_minutes: 120 },
    ],
  });

  assert.ok(text.includes("BUSINESS PROFILE"));
  assert.ok(text.includes("Hair Stylist"));
  assert.ok(text.includes("10 min before"));
  assert.ok(text.includes("15 min after"));
  assert.ok(text.includes("Haircut"));
  assert.ok(text.includes("45 min"));
  assert.ok(text.includes("Color"));
  assert.ok(text.includes("120 min"));
  assert.ok(text.includes("Standard cut"));
}

async function testFormatBusinessProfileNull() {
  assert.equal(formatBusinessProfile(null), "");
  assert.equal(formatBusinessProfile(undefined), "");
}

// ── formatAvailableSlots ────────────────────────────────────────────────────

async function testFormatAvailableSlotsEmpty() {
  const text = formatAvailableSlots([]);
  assert.ok(text.includes("No available slots"));
}

async function testFormatAvailableSlotsGroupsByDate() {
  const text = formatAvailableSlots([
    { date: "2026-04-13", dayName: "Monday", startTime: "09:00", endTime: "10:00", durationMinutes: 60 },
    { date: "2026-04-13", dayName: "Monday", startTime: "11:00", endTime: "12:00", durationMinutes: 60 },
    { date: "2026-04-14", dayName: "Tuesday", startTime: "09:00", endTime: "10:00", durationMinutes: 60 },
  ]);

  assert.ok(text.includes("Monday, 2026-04-13:"));
  assert.ok(text.includes("Tuesday, 2026-04-14:"));
  assert.ok(text.includes("09:00 – 10:00"));
  assert.ok(text.includes("11:00 – 12:00"));
}

// ── formatAppointments ──────────────────────────────────────────────────────

async function testFormatAppointmentsEmpty() {
  const text = formatAppointments([]);
  assert.ok(text.includes("No upcoming appointments"));
}

// ── workingHoursToArray ─────────────────────────────────────────────────────

async function testWorkingHoursToArrayConvertsObject() {
  const arr = workingHoursToArray({
    "1": { start: "09:00", end: "17:00" },
    "5": { start: "10:00", end: "14:00" },
  });
  assert.equal(arr.length, 2);
  assert.ok(arr.find((r) => r.day_of_week === 1 && r.start_time === "09:00" && r.end_time === "17:00"));
  assert.ok(arr.find((r) => r.day_of_week === 5 && r.start_time === "10:00" && r.end_time === "14:00"));
}

async function testWorkingHoursToArrayHandlesNullAndEmpty() {
  assert.deepEqual(workingHoursToArray(null), []);
  assert.deepEqual(workingHoursToArray(undefined), []);
  assert.deepEqual(workingHoursToArray([]), []); // array input returns empty (not the array format)
}

async function testFormatBusinessProfileUsesNewFieldNames() {
  const text = formatBusinessProfile({
    occupation: "Electrician",
    buffer_before_minutes: 20,
    buffer_after_minutes: 10,
    services: [{ name: "Fault Find", duration_minutes: 90 }],
  });
  assert.ok(text.includes("20 min before"));
  assert.ok(text.includes("10 min after"));
}

async function testFormatAppointmentsWithData() {
  const text = formatAppointments([
    {
      id: "a1",
      scheduled_date: "2026-04-13",
      scheduled_time: "10:00",
      duration_minutes: 60,
      client_name: "Jane",
      client_contact: "jane@test.com",
      title: "Consultation",
      status: "confirmed",
    },
  ]);

  assert.ok(text.includes("[id:a1]"));
  assert.ok(text.includes("2026-04-13"));
  assert.ok(text.includes("10:00"));
  assert.ok(text.includes("60 min"));
  assert.ok(text.includes("Jane"));
  assert.ok(text.includes("jane@test.com"));
  assert.ok(text.includes("Consultation"));
}

// ── run ─────────────────────────────────────────────────────────────────────

async function run() {
  await testParseTime();
  await testFormatTime();
  await testDateRangeSingleDay();
  await testDateRangeMultipleDays();
  await testDateRangeCappedAt60Days();
  await testEmptyCalendarDefaultWorkingHours();
  await testNoSlotsOnWeekendWithDefaults();
  await testAppointmentBlocksSlot();
  await testBufferTimesBlockAdjacentSlots();
  await testCancelledAppointmentsIgnored();
  await testCustomWorkingHours();
  await testMaxSlotsPerDayCap();
  await testMultipleDaysReturnSlots();
  await testMissingParamsReturnsEmpty();
  await testFormatBusinessProfileFull();
  await testFormatBusinessProfileNull();
  await testFormatAvailableSlotsEmpty();
  await testFormatAvailableSlotsGroupsByDate();
  await testFormatAppointmentsEmpty();
  await testFormatAppointmentsWithData();
  await testWorkingHoursToArrayConvertsObject();
  await testWorkingHoursToArrayHandlesNullAndEmpty();
  await testFormatBusinessProfileUsesNewFieldNames();
  console.log("scheduler tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
