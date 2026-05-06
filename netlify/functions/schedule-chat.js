"use strict";

const {
  createEntitlementStore,
  createAppointmentStore,
  createBusinessProfileStore,
  createBusyBlockStore,
  createServiceStore,
  createSchedulerMemoryStore,
  createServiceRoleClient,
} = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const tierPolicyLib = require("./_lib/tier-policy");
const { normalizeTier } = require("./_lib/tier-policy");
const {
  findAvailableSlots,
  formatBusinessProfile,
  formatAppointments,
  workingHoursToArray,
} = require("./_lib/scheduler");

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

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildSchedulingContext(profile, appointments, services) {
  const parts = [];

  const profileBlock = formatBusinessProfile(profile);
  if (profileBlock) parts.push(profileBlock);

  if (services && services.length > 0) {
    const svcLines = ["=== SERVICES ==="];
    for (const s of services) {
      const price = s.price != null ? ` — $${Number(s.price).toFixed(2)}` : "";
      const buf   = s.buffer_time_min > 0 ? ` — buffer: ${s.buffer_time_min} min` : "";
      svcLines.push(`[id:${s.id}] ${s.title} — ${s.duration_min} min${price}${buf}`);
    }
    parts.push(svcLines.join("\n"));
  }

  parts.push(formatAppointments(appointments));
  parts.push("Today's date: " + new Date().toISOString().split("T")[0]);

  return parts.join("\n\n");
}

const SCHEDULING_TOOLS = [
  {
    name: "resolve_service",
    description: "Look up a service by its ID to get the authoritative duration, buffer, and price. MUST be called before find_available_slots when the user has selected a service.",
    input_schema: {
      type: "object",
      properties: {
        service_id: {
          type: "string",
          description: "The UUID of the selected service from the === SERVICES === list.",
        },
      },
      required: ["service_id"],
    },
  },
  {
    name: "find_available_slots",
    description: "Find open time slots for a new booking. Computes gaps between existing appointments using the business profile's buffer settings. Always call this to check availability — do not guess.",
    input_schema: {
      type: "object",
      properties: {
        duration_minutes: {
          type: "number",
          description: "Duration of the service in minutes. Use the value from resolve_service if a service was resolved.",
        },
        buffer_before: {
          type: "number",
          description: "Travel/prep time to reserve before the booking (minutes). Overridden by resolve_service buffer if present.",
        },
        buffer_after: {
          type: "number",
          description: "Travel/cleanup time to reserve after the booking (minutes). Overridden by resolve_service buffer if present.",
        },
        start_date: {
          type: "string",
          description: "Start of search range in YYYY-MM-DD format. Defaults to today.",
        },
        end_date: {
          type: "string",
          description: "End of search range in YYYY-MM-DD format. Defaults to 14 days from today.",
        },
        preferred_time_of_day: {
          type: "string",
          enum: ["morning", "afternoon", "evening", "any"],
          description: "Optional preference to filter results by time of day.",
        },
      },
      required: ["duration_minutes"],
    },
  },
  {
    name: "list_appointments",
    description: "List the business owner's upcoming confirmed appointments.",
    input_schema: {
      type: "object",
      properties: {
        include_all: {
          type: "boolean",
          description: "If true, include past and cancelled appointments. Default false.",
        },
      },
      required: [],
    },
  },
  {
    name: "book_appointment",
    description: "Book a new appointment. Use this after confirming the details with the user.",
    input_schema: {
      type: "object",
      properties: {
        client_name:      { type: "string", description: "Client's name." },
        client_contact:   { type: "string", description: "Client's email or phone." },
        title:            { type: "string", description: "Short title for the appointment (use service title if a service was resolved)." },
        scheduled_date:   { type: "string", description: "Date in YYYY-MM-DD format." },
        scheduled_time:   { type: "string", description: "Time in HH:MM 24-hour format." },
        duration_minutes: { type: "number", description: "Duration in minutes. Must match value from resolve_service if a service was resolved." },
        notes:            { type: "string", description: "Optional notes." },
        service_id:       { type: "string", description: "UUID of the resolved service. Include if resolve_service was called." },
      },
      required: ["scheduled_date", "scheduled_time"],
    },
  },
  {
    name: "cancel_appointment",
    description: "Cancel an existing appointment by its ID.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "The UUID of the appointment to cancel." },
      },
      required: ["appointment_id"],
    },
  },
  {
    name: "reschedule_appointment",
    description: "Reschedule an existing appointment to a new date and/or time.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id:   { type: "string", description: "The UUID of the appointment to reschedule." },
        scheduled_date:   { type: "string", description: "New date in YYYY-MM-DD format." },
        scheduled_time:   { type: "string", description: "New time in HH:MM 24-hour format." },
        duration_minutes: { type: "number", description: "New duration in minutes, if changed." },
      },
      required: ["appointment_id"],
    },
  },
  {
    name: "add_busy_block",
    description: "Mark specific date/time ranges as unavailable. Always confirm with user before calling. For recurring commitments, insert one block per date.",
    input_schema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          description: "One or more time ranges to block off.",
          items: {
            type: "object",
            properties: {
              block_date:  { type: "string", description: "Date in YYYY-MM-DD format." },
              start_time:  { type: "string", description: "Start time in HH:MM 24-hour format." },
              end_time:    { type: "string", description: "End time in HH:MM 24-hour format." },
              label:       { type: "string", description: "Short reason e.g. 'Dentist', 'Travel'." },
            },
            required: ["block_date", "start_time", "end_time"],
          },
        },
      },
      required: ["blocks"],
    },
  },
];

const REMEMBER_TOOL = {
  name: "remember",
  description: "Save a persistent memory note about how this business owner runs their schedule. Always pass the FULL updated memory text — this overwrites the previous memory. Use when the user states a standing preference, rule, or client-specific note.",
  input_schema: {
    type: "object",
    properties: {
      memory_text: {
        type: "string",
        description: "The full updated memory text. Include all previously stored facts plus any new ones. Max 4000 characters.",
      },
    },
    required: ["memory_text"],
  },
};

const MAX_TOOL_ROUNDS = 5;

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    getTierPolicy,
    getSchedulingInstructions,
    createSchedulingResponse,
    getBusinessProfile,
    listAppointments,
    listBusyBlocks,
    listServices,
    getService,
    createAppointment,
    updateAppointment,
    createBusyBlocks,
    loadThreadMessages,
    saveMessage,
    getMemory,
    upsertMemory,
  } = deps;

  // toolContext is shared across all tool-call rounds in one request.
  // resolvedService is populated by resolve_service and consumed by
  // find_available_slots and book_appointment within the same request.
  async function executeTool(toolName, args, email, toolContext) {
    switch (toolName) {

      case "resolve_service": {
        const svc = await toolContext.getService(args.service_id, email);
        if (!svc) return { error: "service_not_found" };
        toolContext.resolvedService = svc;
        return {
          id:              svc.id,
          title:           svc.title,
          duration_min:    svc.duration_min,
          buffer_time_min: svc.buffer_time_min,
          price:           svc.price,
        };
      }

      case "find_available_slots": {
        const profile  = toolContext.profile || {};
        const resolved = toolContext.resolvedService;

        const duration = resolved ? resolved.duration_min : args.duration_minutes;
        const svcBuffer = resolved && resolved.buffer_time_min > 0 ? resolved.buffer_time_min : null;
        const bufferBefore = svcBuffer ?? args.buffer_before ?? (profile.buffer_before_minutes ?? 0);
        const bufferAfter  = svcBuffer ?? args.buffer_after  ?? (profile.buffer_after_minutes  ?? 0);
        const stepMinutes  = profile.slot_duration_min || 30;

        const today = new Date().toISOString().split("T")[0];
        const slots = findAvailableSlots({
          appointments:    toolContext.appointments,
          busyBlocks:      toolContext.busyBlocks || [],
          workingHours:    workingHoursToArray(profile.working_hours),
          durationMinutes: duration,
          preBuffer:       bufferBefore,
          postBuffer:      bufferAfter,
          startDate:       args.start_date || today,
          endDate:         args.end_date   || addDays(today, 14),
          maxSlotsPerDay:  3,
          stepMinutes,
        });
        return { slots, count: slots.length };
      }

      case "list_appointments": {
        const upcomingOnly = !args.include_all;
        const appts = await listAppointments(email, upcomingOnly);
        return { appointments: appts };
      }

      case "book_appointment": {
        const resolved = toolContext.resolvedService;
        const title    = args.title || (resolved ? resolved.title : null) || null;
        const duration = resolved ? resolved.duration_min : (args.duration_minutes || 60);

        // Stash service_id in notes until migration adds the column
        let notes = args.notes || null;
        if (args.service_id) {
          const tag = `service_id:${args.service_id}`;
          notes = notes ? `${tag}\n${notes}` : tag;
        }

        const appt = await createAppointment(email, {
          client_name:      args.client_name    || null,
          client_contact:   args.client_contact || null,
          title,
          scheduled_date:   args.scheduled_date,
          scheduled_time:   args.scheduled_time,
          duration_minutes: duration,
          notes,
        });
        return { booked: true, appointment: appt, _notify: true };
      }

      case "cancel_appointment": {
        const appt = await updateAppointment(args.appointment_id, email, { status: "cancelled" });
        return { cancelled: true, appointment: appt };
      }

      case "reschedule_appointment": {
        const updates = { status: "confirmed" };
        if (args.scheduled_date)   updates.scheduled_date   = args.scheduled_date;
        if (args.scheduled_time)   updates.scheduled_time   = args.scheduled_time;
        if (args.duration_minutes) updates.duration_minutes = args.duration_minutes;
        const appt = await updateAppointment(args.appointment_id, email, updates);
        return { rescheduled: true, appointment: appt };
      }

      case "add_busy_block": {
        const incoming = Array.isArray(args.blocks) ? args.blocks : [];
        if (incoming.length === 0) return { error: "no_blocks_provided" };

        const conflicts = [];
        if (toolContext.tier === "Black" && Array.isArray(toolContext.appointments)) {
          for (const block of incoming) {
            for (const appt of toolContext.appointments) {
              if (appt.status !== "confirmed") continue;
              if (appt.scheduled_date !== block.block_date) continue;
              const apptStart = appt.scheduled_time;
              const apptEnd = (() => {
                const [h, m] = appt.scheduled_time.split(":").map(Number);
                const dur = appt.duration_minutes || 60;
                const end = h * 60 + m + dur;
                return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
              })();
              if (block.start_time < apptEnd && block.end_time > apptStart) {
                conflicts.push({ block, appointment: appt });
              }
            }
          }
        }

        const validated = incoming
          .filter((b) => b.block_date && b.start_time && b.end_time)
          .map((b) => ({
            block_date: b.block_date,
            start_time: b.start_time,
            end_time:   b.end_time,
            label:      b.label || null,
            source:     "ai_parsed",
          }));

        if (validated.length === 0) return { error: "no_valid_blocks" };

        const created = await createBusyBlocks(email, validated);
        return {
          blocked:   created.length,
          blocks:    created,
          conflicts: conflicts.length > 0 ? conflicts : undefined,
        };
      }

      case "remember": {
        const text = String(args.memory_text || "").slice(0, 4000);
        if (!text) return { error: "empty_memory_text" };
        if (!upsertMemory) return { error: "memory_not_available" };
        await upsertMemory(email, text);
        toolContext.memory = text;
        return { saved: true };
      }

      default:
        return { error: "unknown_tool" };
    }
  }

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return deny(405, "method_not_allowed");
    }

    let verification;
    try {
      verification = verifySessionCookie(event.headers || {});
    } catch {
      return deny(401, "missing_session");
    }
    if (!verification.ok) return deny(401, verification.reason);

    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return deny(400, "invalid_json"); }

    const message = String(body.message || "").trim();
    if (!message) return deny(400, "missing_message");

    const threadId = body.threadId || null;
    const session  = verification.session;

    let entitlement;
    try {
      entitlement = await findEntitlementByEmail(session.email);
    } catch (err) {
      console.error("[schedule-chat] entitlement lookup failed:", err);
      return deny(500, "entitlement_lookup_failed");
    }
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

    let conversation = Array.isArray(body.conversation) ? body.conversation : [];

    if (threadId && loadThreadMessages) {
      const stored = await loadThreadMessages(threadId, session.email);
      if (stored && stored.length > 0) {
        conversation = stored.map((m) => ({ role: m.role, content: m.content }));
      }
    }

    const isBlack = sessionTier === "Black";
    const hasMemory = isBlack || sessionTier === "Pro";

    let profile = null;
    let appointments = [];
    let busyBlocks = [];
    let services = [];
    let memory = null;
    try {
      const today = new Date().toISOString().split("T")[0];
      const dataLoads = [
        getBusinessProfile(session.email),
        listAppointments(session.email, true),
        listBusyBlocks ? listBusyBlocks(session.email, today) : Promise.resolve([]),
        listServices(session.email),
        hasMemory && getMemory ? getMemory(session.email) : Promise.resolve(null),
      ];
      [profile, appointments, busyBlocks, services, memory] = await Promise.all(dataLoads);
    } catch (_) {
      // Tables may not exist yet — continue with empty context
    }

    const schedulingInstructions = getSchedulingInstructions(sessionTier);
    let contextBlock = buildSchedulingContext(profile, appointments, services);
    if (hasMemory && memory) {
      contextBlock += `\n\n=== MEMORY ===\n${memory}`;
    }
    const extraSystemContext = schedulingInstructions
      ? `${schedulingInstructions}\n\n${contextBlock}`
      : contextBlock;

    const tools = hasMemory ? [...SCHEDULING_TOOLS, REMEMBER_TOOL] : SCHEDULING_TOOLS;

    const toolContext = {
      profile,
      appointments,
      busyBlocks,
      tier: sessionTier,
      resolvedService: null,
      memory,
      getService,
    };

    let messages = conversation.slice();
    messages.push({ role: "user", content: message });

    let finalOutput = "";
    let finalUsage  = null;
    let toolActions = [];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await createSchedulingResponse({
          messages,
          policy,
          extraSystemContext,
          tier: sessionTier,
          tools,
        });

        finalUsage = response.usage;
        const toolCalls = response.toolCalls || [];

        if (toolCalls.length === 0) {
          finalOutput = response.output;
          break;
        }

        // Append assistant turn with tool_use content blocks
        messages.push({ role: "assistant", content: response.rawContent });

        const toolResults = [];
        for (const call of toolCalls) {
          let toolResult;
          try {
            toolResult = await executeTool(call.name, call.input, session.email, toolContext);
            toolActions.push({ tool: call.name, result: toolResult });
          } catch (err) {
            toolResult = { error: err.message || "tool_execution_failed" };
            toolActions.push({ tool: call.name, error: toolResult.error });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify(toolResult),
          });
        }

        // Append tool results as user turn
        messages.push({ role: "user", content: toolResults });
      }
    } catch (err) {
      console.error("[schedule-chat] ai loop error:", err?.message || err);
      return deny(500, "ai_error");
    }

    if (threadId && saveMessage) {
      await saveMessage(threadId, "user", message);
      if (finalOutput) await saveMessage(threadId, "assistant", finalOutput);
    }

    const bookAction = toolActions.find(a => a.result && a.result._notify);
    for (const a of toolActions) {
      if (a.result && a.result._notify) delete a.result._notify;
    }

    return json(200, {
      ok: true,
      tier: sessionTier,
      output: finalOutput,
      usage: finalUsage,
      actions: toolActions.length > 0 ? toolActions : undefined,
      notification: bookAction ? {
        type: "appointment_created",
        appointment: bookAction.result.appointment,
      } : undefined,
      threadId: threadId || undefined,
    });
  };
}

function createRuntimeHandler(overrides = {}) {
  let entitlementStore, profileStore, appointmentStore, busyBlockStore, serviceStore, memoryStore;
  try {
    entitlementStore = overrides.entitlementStore || createEntitlementStore();
    profileStore     = overrides.profileStore     || createBusinessProfileStore();
    appointmentStore = overrides.appointmentStore || createAppointmentStore();
    busyBlockStore   = overrides.busyBlockStore   || createBusyBlockStore();
    serviceStore     = overrides.serviceStore     || createServiceStore();
    memoryStore      = overrides.memoryStore      || createSchedulerMemoryStore();
  } catch (err) {
    console.error("[schedule-chat] store construction failed:", err);
    return async () => deny(500, "store_init_failed");
  }
  const runtimeSessionLib = overrides.sessionLib    || sessionLib;
  const runtimePolicyLib  = overrides.tierPolicyLib || tierPolicyLib;

  let _supabase;
  function getSupabase() {
    if (!_supabase) _supabase = overrides.supabase || createServiceRoleClient();
    return _supabase;
  }

  return createHandler({
    verifySessionCookie:       (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail:    (e) => entitlementStore.findEntitlementByEmail(e),
    getTierPolicy:             (t) => runtimePolicyLib.getTierPolicy(t),
    getSchedulingInstructions: (t) => runtimePolicyLib.getSchedulingInstructions(t),
    getBusinessProfile:        (e) => profileStore.getProfile(e),
    listAppointments:          (e, u) => appointmentStore.listAppointments(e, u),
    listBusyBlocks:            (e, s) => busyBlockStore.listBusyBlocks(e, s, null),
    listServices:              (e) => serviceStore.listServices(e),
    getService:                (id, e) => serviceStore.getService(id, e),
    createAppointment:         (e, a) => appointmentStore.createAppointment(e, a),
    updateAppointment:         (id, e, u) => appointmentStore.updateAppointment(id, e, u),
    createBusyBlocks:          (e, b) => busyBlockStore.createBusyBlocks(e, b),
    getMemory:                 (e)    => memoryStore.getMemory(e),
    upsertMemory:              (e, t) => memoryStore.upsertMemory(e, t),

    createSchedulingResponse: async ({ messages, policy, extraSystemContext, tier, tools }) => {
      const system = [tier ? `Tier: ${tier}` : null, extraSystemContext].filter(Boolean).join("\n\n");

      const apiKey    = process.env.ANTHROPIC_API_KEY;
      const model     = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
      const fetchImpl = overrides.fetchImpl || fetch;

      console.log("[schedule-chat] Anthropic request model=%s messages=%d hasKey=%s", model, messages.length, !!apiKey);

      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, system, messages, max_tokens: 4096, tools }),
      });

      if (!response.ok) {
        let errBody;
        try { errBody = await response.json(); } catch (_) { errBody = await response.text().catch(() => "(unreadable)"); }
        console.error("[schedule-chat] Anthropic error", response.status, JSON.stringify(errBody));
        throw new Error(`Anthropic request failed: ${response.status}`);
      }

      const data = await response.json();
      const toolCalls = [];
      const rawContent = Array.isArray(data.content) ? data.content : [];

      for (const block of rawContent) {
        if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      const outputText = rawContent
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");

      return { output: outputText, usage: data.usage, toolCalls, rawContent };
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
      await getSupabase().from("messages").insert({ thread_id: threadId, role, content });
      await getSupabase().from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
    },
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[schedule-chat] unhandled error:", err);
    return deny(500, "server_error");
  }
}

exports.createHandler          = createHandler;
exports.createRuntimeHandler   = createRuntimeHandler;
exports.handler                = handler;
exports.buildSchedulingContext = buildSchedulingContext;
exports.SCHEDULING_TOOLS       = SCHEDULING_TOOLS;
