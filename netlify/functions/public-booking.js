const { createPublicBookingStore, createAppointmentStore, createPushSubscriptionStore, createServiceRoleClient } = require("./_lib/supabase");
const { json, denied } = require("./_lib/http");
const { normalizeTier } = require("./_lib/tier-policy");
const { findAvailableSlots, workingHoursToArray } = require("./_lib/scheduler");
const { generateICS } = require("./_lib/ical");

let webpush;
try { webpush = require("web-push"); } catch (_) { /* not installed */ }

const SCHEDULING_TIERS = new Set(["Pro", "Black"]);
const MAX_CONVERSATION_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_TOOL_ROUNDS = 5;

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildClientSystemPrompt(profile) {
  const businessName = profile.occupation || "this business";
  const parts = [
    `You are a scheduling assistant for ${businessName}. Help clients book an appointment.`,
    "- Use find_available_slots to check availability before suggesting times. Never guess.",
    "- Present 2-3 options with day, date, and time.",
    "- Before calling confirm_booking, you MUST have: client name, client email, selected service, confirmed date/time.",
    '- After booking: "Confirmed — [day], [date] at [time], [duration] minutes. Download your calendar invite below. You\'ll get a reminder 24 hours before."',
    "- Only discuss scheduling. Never discuss pricing, business advice, or internal details.",
    "- Never reveal the owner's email address.",
    "Keep responses concise and professional.",
  ];

  if (Array.isArray(profile.services) && profile.services.length > 0) {
    parts.push("\nAvailable services:");
    for (const svc of profile.services) {
      const dur = svc.duration_minutes ? ` (${svc.duration_minutes} min)` : "";
      parts.push(`- ${svc.name}${dur}`);
    }
  }

  parts.push("\nToday's date: " + new Date().toISOString().split("T")[0]);

  return parts.join("\n");
}

const BOOKING_TOOLS = [
  {
    type: "function",
    name: "find_available_slots",
    description: "Find open time slots for a new booking. Always call this to check availability — do not guess.",
    parameters: {
      type: "object",
      properties: {
        duration_minutes: {
          type: "number",
          description: "Duration of the service in minutes.",
        },
        start_date: {
          type: "string",
          description: "Start of search range in YYYY-MM-DD format. Defaults to today.",
        },
        end_date: {
          type: "string",
          description: "End of search range in YYYY-MM-DD format. Defaults to 14 days from today.",
        },
      },
      required: ["duration_minutes"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "confirm_booking",
    description: "Confirm and create an appointment booking. Only call this after you have collected: client name, client email, selected service, and confirmed date/time.",
    parameters: {
      type: "object",
      properties: {
        client_name:      { type: "string", description: "Client's full name." },
        client_email:     { type: "string", description: "Client's email address." },
        service_name:     { type: "string", description: "Name of the selected service." },
        scheduled_date:   { type: "string", description: "Date in YYYY-MM-DD format." },
        scheduled_time:   { type: "string", description: "Time in HH:MM 24-hour format." },
        duration_minutes: { type: "number", description: "Duration in minutes." },
        notes:            { type: "string", description: "Optional notes." },
      },
      required: ["client_name", "client_email", "service_name", "scheduled_date", "scheduled_time", "duration_minutes"],
      additionalProperties: false,
    },
    strict: false,
  },
];

function createHandler(deps) {
  const {
    getProfileBySlug,
    getEntitlementByEmail,
    listAppointments,
    createAppointment,
    generateICSData,
    sendOwnerNotification,
    callOpenAI,
  } = deps;

  async function executeTool(toolName, args, context) {
    switch (toolName) {
      case "find_available_slots": {
        const profile = context.profile || {};
        const bufferBefore = profile.buffer_before_minutes || 0;
        const bufferAfter = profile.buffer_after_minutes || 0;
        const today = new Date().toISOString().split("T")[0];
        const slots = findAvailableSlots({
          appointments: context.appointments,
          workingHours: workingHoursToArray(profile.working_hours),
          durationMinutes: args.duration_minutes,
          preBuffer: bufferBefore,
          postBuffer: bufferAfter,
          startDate: args.start_date || today,
          endDate: args.end_date || addDays(today, 14),
          maxSlotsPerDay: 3,
        });
        return { slots, count: slots.length };
      }
      case "confirm_booking": {
        const ownerEmail = context.ownerEmail;
        const profile = context.profile || {};

        const appt = await createAppointment(ownerEmail, {
          client_name: args.client_name,
          client_contact: args.client_email,
          client_email: args.client_email,
          title: args.service_name,
          scheduled_date: args.scheduled_date,
          scheduled_time: args.scheduled_time,
          duration_minutes: args.duration_minutes || 60,
          notes: args.notes || null,
        });

        const icsData = generateICSData({
          title: args.service_name,
          description: `Appointment with ${args.client_name}`,
          startDate: args.scheduled_date,
          startTime: args.scheduled_time,
          durationMinutes: args.duration_minutes || 60,
          organizerName: profile.occupation || null,
          organizerEmail: null, // never expose owner email to client
          attendeeName: args.client_name,
          attendeeEmail: args.client_email,
        });

        // Send push notification to owner (fire-and-forget)
        if (sendOwnerNotification) {
          sendOwnerNotification(ownerEmail, {
            title: "Text Boss · New Booking",
            body: [
              args.service_name || "Appointment",
              `with ${args.client_name}`,
              `on ${args.scheduled_date} at ${args.scheduled_time}`,
            ].filter(Boolean).join(" "),
            data: { appointmentId: appt.id },
          }).catch(() => {});
        }

        return {
          booked: true,
          appointment: appt,
          icsData,
        };
      }
      default:
        return { error: "unknown_tool" };
    }
  }

  return async function handler(event) {
    if (event.httpMethod === "OPTIONS") {
      return json(204, "", {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, reason: "method_not_allowed" });
    }

    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return json(400, { ok: false, reason: "invalid_json" }); }

    const slug = String(body.slug || "").trim();
    if (!slug) {
      return json(404, { ok: false, reason: "not_found" });
    }

    // Look up owner profile by slug
    const profile = await getProfileBySlug(slug);
    if (!profile) {
      return json(404, { ok: false, reason: "not_found" });
    }

    // Verify owner has active Pro/Black entitlement
    const entitlement = await getEntitlementByEmail(profile.email);
    if (!entitlement) {
      return json(404, { ok: false, reason: "not_found" });
    }

    const status = normalizeStatus(entitlement.subscription_status);
    if (status !== "active" && status !== "trialing") {
      return json(404, { ok: false, reason: "not_found" });
    }

    const tier = normalizeTier(entitlement.entitled_tier);
    if (!SCHEDULING_TIERS.has(tier)) {
      return json(404, { ok: false, reason: "not_found" });
    }

    const message = String(body.message || "").trim();
    if (!message) {
      return json(400, { ok: false, reason: "missing_message" });
    }

    // ── Init request: return profile data, no AI call ──────────────────────
    if (message === "__init__") {
      return json(200, {
        ok: true,
        businessName: profile.occupation || null,
        services: Array.isArray(profile.services) ? profile.services : [],
      });
    }

    // ── Validation ─────────────────────────────────────────────────────────
    if (message.length > MAX_MESSAGE_LENGTH) {
      return json(400, { ok: false, reason: "message_too_long" });
    }

    const conversation = Array.isArray(body.conversation) ? body.conversation : [];
    if (conversation.length > MAX_CONVERSATION_LENGTH) {
      return json(400, { ok: false, reason: "conversation_too_long" });
    }

    // ── Load owner's appointments for availability checking ────────────────
    let appointments = [];
    try {
      appointments = await listAppointments(profile.email, true);
    } catch (_) {
      // continue with empty
    }

    const toolContext = {
      profile,
      appointments,
      ownerEmail: profile.email,
    };

    const systemPrompt = buildClientSystemPrompt(profile);

    // ── Tool-calling loop ──────────────────────────────────────────────────
    let currentConversation = conversation.slice();
    let finalOutput = "";
    let bookingResult = null;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await callOpenAI({
          systemPrompt,
          message: round === 0 ? message : null,
          conversation: currentConversation,
          tools: BOOKING_TOOLS,
        });

        const toolCalls = response.toolCalls || [];

        if (toolCalls.length === 0) {
          finalOutput = response.output;
          break;
        }

        // Add raw assistant output to conversation for continuation
        currentConversation.push({
          type: "function_call_output",
          _raw: response.rawOutput,
        });

        for (const call of toolCalls) {
          let toolResult;
          try {
            const args = typeof call.arguments === "string"
              ? JSON.parse(call.arguments)
              : (call.arguments || {});
            toolResult = await executeTool(call.name, args, toolContext);

            if (toolResult.booked) {
              bookingResult = {
                id: toolResult.appointment.id,
                date: toolResult.appointment.scheduled_date,
                time: toolResult.appointment.scheduled_time,
                duration: toolResult.appointment.duration_minutes,
                title: toolResult.appointment.title,
                icsData: toolResult.icsData,
              };
            }
          } catch (err) {
            toolResult = { error: err.message || "tool_execution_failed" };
          }

          // Strip icsData from tool result sent back to OpenAI (too large for context)
          const toolResultForAI = { ...toolResult };
          delete toolResultForAI.icsData;

          currentConversation.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(toolResultForAI),
          });
        }
      }
    } catch (_) {
      return json(500, { ok: false, reason: "ai_error" });
    }

    const result = {
      ok: true,
      output: finalOutput,
    };

    if (bookingResult) {
      result.booking = bookingResult;
    }

    return json(200, result);
  };
}

function createRuntimeHandler(overrides = {}) {
  const bookingStore = overrides.bookingStore || createPublicBookingStore();
  const appointmentStore = overrides.appointmentStore || createAppointmentStore();
  const pushStore = overrides.pushStore || createPushSubscriptionStore();

  // Configure VAPID once
  let vapidReady = false;
  if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:noreply@textboss.app",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    vapidReady = true;
  }

  return createHandler({
    getProfileBySlug: (slug) => bookingStore.getProfileBySlug(slug),
    getEntitlementByEmail: (email) => bookingStore.getEntitlementByEmail(email),
    listAppointments: (email, upcoming) => appointmentStore.listAppointments(email, upcoming),

    createAppointment: (email, appt) => appointmentStore.createAppointment(email, appt),

    generateICSData: (params) => generateICS(params),

    sendOwnerNotification: vapidReady
      ? async (ownerEmail, payload) => {
          const subscriptions = await pushStore.getSubscriptionsByEmail(ownerEmail);
          for (const sub of subscriptions) {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                JSON.stringify(payload)
              );
            } catch (err) {
              if (err && (err.statusCode === 410 || err.statusCode === 404)) {
                await pushStore.deleteSubscriptionById(sub.id).catch(() => {});
              }
            }
          }
        }
      : null,

    callOpenAI: async ({ systemPrompt, message, conversation, tools }) => {
      const apiKey = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_MODEL;
      const fetchImpl = overrides.fetchImpl || fetch;

      const input = [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
      ];

      for (const item of conversation) {
        if (item.type === "function_call_output" && item.call_id) {
          input.push(item);
        } else if (item.type === "function_call_output" && item._raw) {
          if (Array.isArray(item._raw)) {
            for (const rawItem of item._raw) {
              input.push(rawItem);
            }
          }
        } else if (item.role) {
          input.push(item);
        }
      }

      if (message) {
        input.push({
          role: "user",
          content: [{ type: "input_text", text: message }],
        });
      }

      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input,
          max_output_tokens: 600,
          tools,
        }),
      });

      if (!response.ok) {
        throw new Error("OpenAI request failed");
      }

      const data = await response.json();

      const toolCalls = [];
      const rawOutput = [];

      if (Array.isArray(data.output)) {
        for (const item of data.output) {
          rawOutput.push(item);
          if (item.type === "function_call") {
            toolCalls.push({
              call_id: item.call_id,
              name: item.name,
              arguments: item.arguments,
            });
          }
        }
      }

      let outputText = "";
      if (typeof data.output_text === "string" && data.output_text) {
        outputText = data.output_text;
      } else if (Array.isArray(data.output)) {
        outputText = data.output
          .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
          .filter((item) => item?.type === "output_text" && typeof item.text === "string")
          .map((item) => item.text)
          .join("");
      }

      return {
        output: outputText,
        toolCalls,
        rawOutput,
      };
    },
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch {
    return json(500, { ok: false, reason: "server_error" });
  }
}

exports.createHandler = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler = handler;
