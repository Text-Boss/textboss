const { createEntitlementStore, createAvailabilityStore, createAppointmentStore, createServiceRoleClient } = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const tierPolicyLib = require("./_lib/tier-policy");
const { createResponsesClient } = require("./_lib/openai");
const { normalizeTier } = require("./_lib/tier-policy");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function deny(statusCode, reason) {
  return json(statusCode, { ok: false, denied: statusCode === 401 || statusCode === 403, reason });
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

const SCHEDULING_TIERS = new Set(["Pro", "Black"]);

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildSchedulingContext(availability, appointments) {
  const lines = ["=== SCHEDULING CONTEXT ==="];

  lines.push("\nWeekly Availability:");
  if (!availability || availability.length === 0) {
    lines.push("- No availability configured.");
  } else {
    for (const slot of availability) {
      const day = DAYS[slot.day_of_week] || `Day ${slot.day_of_week}`;
      lines.push(`- ${day}: ${slot.start_time} – ${slot.end_time}`);
    }
  }

  lines.push("\nUpcoming Appointments:");
  if (!appointments || appointments.length === 0) {
    lines.push("- No upcoming appointments.");
  } else {
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
  }

  lines.push("\nToday's date: " + new Date().toISOString().split("T")[0]);

  return lines.join("\n");
}

const SCHEDULING_TOOLS = [
  {
    type: "function",
    name: "get_availability",
    description: "Retrieve the business owner's weekly availability slots.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "list_appointments",
    description: "List the business owner's upcoming confirmed appointments.",
    parameters: {
      type: "object",
      properties: {
        include_all: {
          type: "boolean",
          description: "If true, include past and cancelled appointments. Default false.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "book_appointment",
    description: "Book a new appointment. Use this after confirming the details with the user.",
    parameters: {
      type: "object",
      properties: {
        client_name:    { type: "string", description: "Client's name." },
        client_contact: { type: "string", description: "Client's email or phone." },
        title:          { type: "string", description: "Short title for the appointment." },
        scheduled_date: { type: "string", description: "Date in YYYY-MM-DD format." },
        scheduled_time: { type: "string", description: "Time in HH:MM 24-hour format." },
        duration_minutes: { type: "number", description: "Duration in minutes. Default 60." },
        notes:          { type: "string", description: "Optional notes." },
      },
      required: ["scheduled_date", "scheduled_time"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "cancel_appointment",
    description: "Cancel an existing appointment by its ID.",
    parameters: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "The UUID of the appointment to cancel." },
      },
      required: ["appointment_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "reschedule_appointment",
    description: "Reschedule an existing appointment to a new date and/or time.",
    parameters: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "The UUID of the appointment to reschedule." },
        scheduled_date: { type: "string", description: "New date in YYYY-MM-DD format." },
        scheduled_time: { type: "string", description: "New time in HH:MM 24-hour format." },
        duration_minutes: { type: "number", description: "New duration in minutes, if changed." },
      },
      required: ["appointment_id"],
      additionalProperties: false,
    },
    strict: false,
  },
];

const MAX_TOOL_ROUNDS = 5;

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    getTierPolicy,
    getSchedulingInstructions,
    createSchedulingResponse,
    listAvailability,
    listAppointments,
    createAppointment,
    updateAppointment,
    loadThreadMessages,
    saveMessage,
  } = deps;

  async function executeTool(toolName, args, email) {
    switch (toolName) {
      case "get_availability": {
        const slots = await listAvailability(email);
        return { availability: slots };
      }
      case "list_appointments": {
        const upcomingOnly = !args.include_all;
        const appts = await listAppointments(email, upcomingOnly);
        return { appointments: appts };
      }
      case "book_appointment": {
        const appt = await createAppointment(email, {
          client_name:      args.client_name      || null,
          client_contact:   args.client_contact   || null,
          title:            args.title            || null,
          scheduled_date:   args.scheduled_date,
          scheduled_time:   args.scheduled_time,
          duration_minutes: args.duration_minutes || 60,
          notes:            args.notes            || null,
        });
        return { booked: true, appointment: appt };
      }
      case "cancel_appointment": {
        const appt = await updateAppointment(args.appointment_id, email, { status: "cancelled" });
        return { cancelled: true, appointment: appt };
      }
      case "reschedule_appointment": {
        const updates = {};
        if (args.scheduled_date) updates.scheduled_date = args.scheduled_date;
        if (args.scheduled_time) updates.scheduled_time = args.scheduled_time;
        if (args.duration_minutes) updates.duration_minutes = args.duration_minutes;
        updates.status = "confirmed";
        const appt = await updateAppointment(args.appointment_id, email, updates);
        return { rescheduled: true, appointment: appt };
      }
      default:
        return { error: "unknown_tool" };
    }
  }

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return deny(405, "method_not_allowed");
    }

    const verification = verifySessionCookie(event.headers || {});
    if (!verification.ok) return deny(401, verification.reason);

    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return deny(400, "invalid_json"); }

    const message = String(body.message || "").trim();
    if (!message) return deny(400, "missing_message");

    const threadId = body.threadId || null;

    const session = verification.session;
    const entitlement = await findEntitlementByEmail(session.email);
    if (!entitlement) return deny(403, "not_found");

    if (normalizeStatus(entitlement.subscription_status) !== "active" &&
        normalizeStatus(entitlement.subscription_status) !== "trialing") {
      return deny(403, "not_active");
    }

    const entitlementTier = normalizeTier(entitlement.entitled_tier);
    const sessionTier     = normalizeTier(session.tier);
    if (!entitlementTier || !sessionTier || entitlementTier !== sessionTier) {
      return deny(403, "invalid_tier");
    }

    if (!SCHEDULING_TIERS.has(sessionTier)) {
      return deny(403, "tier_not_entitled");
    }

    const policy = getTierPolicy(sessionTier);

    if (message.length > policy.inputLimit) {
      return deny(400, "message_too_long");
    }

    // Load conversation history from thread if available
    let conversation = Array.isArray(body.conversation) ? body.conversation : [];

    if (threadId && loadThreadMessages) {
      const storedMessages = await loadThreadMessages(threadId, session.email);
      if (storedMessages && storedMessages.length > 0) {
        conversation = storedMessages.map(function (m) {
          if (m.role === "user") {
            return {
              role: "user",
              content: [{ type: "input_text", text: m.content }],
            };
          }
          return {
            role: "assistant",
            content: [{ type: "output_text", text: m.content }],
          };
        });
      }
    }

    let availability = [];
    let appointments = [];
    try {
      [availability, appointments] = await Promise.all([
        listAvailability(session.email),
        listAppointments(session.email, true),
      ]);
    } catch (_) {
      // Tables may not exist yet — continue with empty context
    }

    const schedulingInstructions = getSchedulingInstructions(sessionTier);
    const contextBlock = buildSchedulingContext(availability, appointments);

    const extraSystemContext = schedulingInstructions
      ? `${schedulingInstructions}\n\n${contextBlock}`
      : contextBlock;

    // Tool-calling loop: send to OpenAI, execute any tool calls, feed results back
    let currentConversation = conversation.slice();
    let finalOutput = "";
    let finalUsage = null;
    let toolActions = [];

    try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await createSchedulingResponse({
        tier: sessionTier,
        message: round === 0 ? message : null,
        conversation: currentConversation,
        policy,
        extraSystemContext,
        tools: SCHEDULING_TOOLS,
      });

      finalUsage = response.usage;

      // Check if the response contains tool calls
      const toolCalls = response.toolCalls || [];

      if (toolCalls.length === 0) {
        // No tool calls — this is the final text response
        finalOutput = response.output;
        break;
      }

      // Execute each tool call and build the continuation
      // Add the assistant message with tool calls to conversation
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
          toolResult = await executeTool(call.name, args, session.email);
          toolActions.push({ tool: call.name, result: toolResult });
        } catch (err) {
          toolResult = { error: err.message || "tool_execution_failed" };
          toolActions.push({ tool: call.name, error: toolResult.error });
        }

        currentConversation.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(toolResult),
        });
      }
    }
    } catch (err) {
      return deny(500, "ai_error");
    }

    // Save messages to thread if threadId provided
    if (threadId && saveMessage) {
      await saveMessage(threadId, "user", message);
      if (finalOutput) {
        await saveMessage(threadId, "assistant", finalOutput);
      }
    }

    return json(200, {
      ok: true,
      tier: sessionTier,
      output: finalOutput,
      usage: finalUsage,
      actions: toolActions.length > 0 ? toolActions : undefined,
      threadId: threadId || undefined,
    });
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore  = overrides.entitlementStore  || createEntitlementStore();
  const availabilityStore = overrides.availabilityStore || createAvailabilityStore();
  const appointmentStore  = overrides.appointmentStore  || createAppointmentStore();
  const runtimeSessionLib = overrides.sessionLib        || sessionLib;
  const runtimePolicyLib  = overrides.tierPolicyLib     || tierPolicyLib;
  const openaiClient      = overrides.openaiClient      || createResponsesClient();

  let _supabase;
  function getSupabase() {
    if (!_supabase) {
      _supabase = overrides.supabase || createServiceRoleClient();
    }
    return _supabase;
  }

  return createHandler({
    verifySessionCookie:      (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail:   (e) => entitlementStore.findEntitlementByEmail(e),
    getTierPolicy:            (t) => runtimePolicyLib.getTierPolicy(t),
    getSchedulingInstructions:(t) => runtimePolicyLib.getSchedulingInstructions(t),
    listAvailability:         (e) => availabilityStore.listAvailability(e),
    listAppointments:         (e, u) => appointmentStore.listAppointments(e, u),
    createAppointment:        (e, a) => appointmentStore.createAppointment(e, a),
    updateAppointment:        (id, e, u) => appointmentStore.updateAppointment(id, e, u),

    createSchedulingResponse: async ({ tier, message, conversation, policy, extraSystemContext, tools }) => {
      const systemParts = [`Tier: ${tier}`, policy.instructions];
      if (extraSystemContext) {
        systemParts.push(extraSystemContext);
      }
      const systemText = systemParts.join("\n\n");

      const input = [
        {
          role: "system",
          content: [{ type: "input_text", text: systemText }],
        },
      ];

      // Add conversation history, filtering out raw function_call_output entries
      for (const item of conversation) {
        if (item.type === "function_call_output" && item.call_id) {
          input.push(item);
        } else if (item.type === "function_call_output" && item._raw) {
          // Re-add raw assistant output items from tool calling rounds
          if (Array.isArray(item._raw)) {
            for (const rawItem of item._raw) {
              input.push(rawItem);
            }
          }
        } else if (item.role) {
          input.push(item);
        }
      }

      // Add current user message if this is the first round
      if (message) {
        input.push({
          role: "user",
          content: [{ type: "input_text", text: message }],
        });
      }

      const apiKey = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_MODEL;
      const fetchImpl = overrides.fetchImpl || fetch;

      const requestBody = {
        model,
        input,
        max_output_tokens: policy.responseMaxTokens,
        tools,
      };

      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error("OpenAI request failed");
      }

      const data = await response.json();

      // Extract tool calls from the response
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

      // Extract text output
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
        usage: data.usage,
        toolCalls,
        rawOutput,
      };
    },

    loadThreadMessages: async (threadId, email) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { data: thread } = await getSupabase()
        .from("threads")
        .select("id")
        .eq("id", threadId)
        .ilike("email", normalizedEmail)
        .maybeSingle();

      if (!thread) return [];

      const { data, error } = await getSupabase()
        .from("messages")
        .select("role, content")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (error) return [];
      return data || [];
    },

    saveMessage: async (threadId, role, content) => {
      await getSupabase()
        .from("messages")
        .insert({ thread_id: threadId, role, content });

      await getSupabase()
        .from("threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId);
    },
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    return deny(500, "server_error");
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
exports.buildSchedulingContext = buildSchedulingContext;
exports.SCHEDULING_TOOLS     = SCHEDULING_TOOLS;
