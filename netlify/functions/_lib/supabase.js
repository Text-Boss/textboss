const { createClient } = require("@supabase/supabase-js");

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function createServiceRoleClient() {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
}

function createEntitlementStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async findEntitlementByEmail(email) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("entitlements")
        .select("email, entitled_tier, subscription_status, current_period_end, updated_at")
        .ilike("email", normalizedEmail)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data;
    },
  };
}

function createAvailabilityStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async listAvailability(email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("availability")
        .select("id, day_of_week, start_time, end_time")
        .ilike("owner_email", normalized)
        .eq("is_active", true)
        .order("day_of_week", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async addAvailability(email, slot) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("availability")
        .insert({
          owner_email: normalized,
          day_of_week: slot.day_of_week,
          start_time: slot.start_time,
          end_time: slot.end_time,
          is_active: true,
        })
        .select("id, day_of_week, start_time, end_time")
        .single();
      if (error) throw error;
      return data;
    },

    async removeAvailability(id, email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { error } = await client
        .from("availability")
        .update({ is_active: false })
        .eq("id", id)
        .ilike("owner_email", normalized);
      if (error) throw error;
    },
  };
}

function createAppointmentStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async listAppointments(email, upcomingOnly = true) {
      const normalized = String(email || "").trim().toLowerCase();
      let query = client
        .from("appointments")
        .select("id, client_name, client_contact, title, scheduled_date, scheduled_time, duration_minutes, status, notes, created_at")
        .ilike("owner_email", normalized)
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true });
      if (upcomingOnly) {
        const today = new Date().toISOString().split("T")[0];
        query = query.gte("scheduled_date", today);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    async createAppointment(email, appt) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("appointments")
        .insert({
          owner_email: normalized,
          client_name:      appt.client_name      || null,
          client_contact:   appt.client_contact   || null,
          title:            appt.title            || null,
          scheduled_date:   appt.scheduled_date,
          scheduled_time:   appt.scheduled_time,
          duration_minutes: appt.duration_minutes || 60,
          status:           "confirmed",
          notes:            appt.notes            || null,
        })
        .select("id, client_name, client_contact, title, scheduled_date, scheduled_time, duration_minutes, status, notes, created_at")
        .single();
      if (error) throw error;
      return data;
    },

    async updateAppointment(id, email, updates) {
      const normalized = String(email || "").trim().toLowerCase();
      const allowed = { updated_at: new Date().toISOString() };
      const fields = ["status", "scheduled_date", "scheduled_time",
                      "duration_minutes", "notes", "client_name",
                      "client_contact", "title"];
      for (const f of fields) {
        if (updates[f] !== undefined) allowed[f] = updates[f];
      }
      const { data, error } = await client
        .from("appointments")
        .update(allowed)
        .eq("id", id)
        .ilike("owner_email", normalized)
        .select("id, client_name, client_contact, title, scheduled_date, scheduled_time, duration_minutes, status, notes")
        .single();
      if (error) throw error;
      return data;
    },

    async deleteAppointment(id, email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { error } = await client
        .from("appointments")
        .delete()
        .eq("id", id)
        .ilike("owner_email", normalized);
      if (error) throw error;
    },
  };
}

function createBusinessProfileStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async getProfile(email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("business_profiles")
        .select("email, occupation, services, buffer_before_minutes, buffer_after_minutes, working_hours, onboarding_complete, booking_slug, updated_at")
        .ilike("email", normalized)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async upsertProfile(email, updates) {
      const normalized = String(email || "").trim().toLowerCase();
      const payload = { email: normalized, updated_at: new Date().toISOString() };
      const allowed = ["occupation", "services", "buffer_before_minutes",
                       "buffer_after_minutes", "working_hours", "onboarding_complete",
                       "booking_slug"];
      for (const f of allowed) {
        if (updates[f] !== undefined) payload[f] = updates[f];
      }
      const { data, error } = await client
        .from("business_profiles")
        .upsert(payload, { onConflict: "email" })
        .select("email, occupation, services, buffer_before_minutes, buffer_after_minutes, working_hours, onboarding_complete, booking_slug, updated_at")
        .single();
      if (error) throw error;
      return data;
    },
  };
}

function createPushSubscriptionStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async saveSubscription(email, subscription) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("push_subscriptions")
        .upsert({
          email:    normalized,
          endpoint: subscription.endpoint,
          p256dh:   subscription.keys.p256dh,
          auth:     subscription.keys.auth,
        }, { onConflict: "email,endpoint" })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },

    async deleteSubscription(email, endpoint) {
      const normalized = String(email || "").trim().toLowerCase();
      const { error } = await client
        .from("push_subscriptions")
        .delete()
        .ilike("email", normalized)
        .eq("endpoint", endpoint);
      if (error) throw error;
    },

    async getSubscriptionsByEmail(email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .ilike("email", normalized);
      if (error) throw error;
      return data || [];
    },

    async deleteSubscriptionById(id) {
      const { error } = await client
        .from("push_subscriptions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
  };
}

function createPublicBookingStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async getProfileBySlug(slug) {
      const { data, error } = await client
        .from("business_profiles")
        .select("email, occupation, services, buffer_before_minutes, buffer_after_minutes, working_hours, onboarding_complete, booking_slug, updated_at")
        .eq("booking_slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async getEntitlementByEmail(email) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("entitlements")
        .select("email, entitled_tier, subscription_status, current_period_end, updated_at")
        .ilike("email", normalizedEmail)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}

function createFollowUpStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async createJob(email, jobData) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("follow_up_jobs")
        .insert({
          owner_email:    normalized,
          client_name:    jobData.client_name,
          client_contact: jobData.client_contact || null,
          service_name:   jobData.service_name,
          service_date:   jobData.service_date,
          notes:          jobData.notes          || null,
          review_link:    jobData.review_link    || null,
          rebooking_link: jobData.rebooking_link || null,
          status:         "active",
        })
        .select("id, client_name, client_contact, service_name, service_date, notes, review_link, rebooking_link, status, created_at")
        .single();
      if (error) throw error;
      return data;
    },

    async createMessages(messages) {
      if (!messages || messages.length === 0) return [];
      const { data, error } = await client
        .from("follow_up_messages")
        .insert(messages)
        .select("id, job_id, owner_email, send_date, purpose, draft_message, status, created_at");
      if (error) throw error;
      return data || [];
    },

    async listJobs(email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { data, error } = await client
        .from("follow_up_jobs")
        .select("id, client_name, client_contact, service_name, service_date, notes, review_link, rebooking_link, status, created_at, updated_at")
        .ilike("owner_email", normalized)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async listMessages(email, options = {}) {
      const normalized = String(email || "").trim().toLowerCase();
      let query = client
        .from("follow_up_messages")
        .select("id, job_id, send_date, purpose, draft_message, status, notified_at, created_at")
        .ilike("owner_email", normalized)
        .order("send_date", { ascending: true });
      if (options.status) {
        query = query.eq("status", options.status);
      }
      if (options.jobId) {
        query = query.eq("job_id", options.jobId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    async listPendingMessages(dateStr) {
      const { data, error } = await client
        .from("follow_up_messages")
        .select("id, job_id, owner_email, send_date, purpose, draft_message, status, created_at")
        .eq("status", "pending")
        .lte("send_date", dateStr)
        .order("send_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async markNotified(messageId) {
      const { error } = await client
        .from("follow_up_messages")
        .update({ status: "notified", notified_at: new Date().toISOString() })
        .eq("id", messageId);
      if (error) throw error;
    },

    async markSent(messageId, email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { error } = await client
        .from("follow_up_messages")
        .update({ status: "sent" })
        .eq("id", messageId)
        .ilike("owner_email", normalized);
      if (error) throw error;
    },

    async skipMessage(messageId, email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { error } = await client
        .from("follow_up_messages")
        .update({ status: "skipped" })
        .eq("id", messageId)
        .ilike("owner_email", normalized);
      if (error) throw error;
    },

    async updateJob(jobId, email, updates) {
      const normalized = String(email || "").trim().toLowerCase();
      const allowed = { updated_at: new Date().toISOString() };
      const fields = ["status", "review_link", "rebooking_link", "notes"];
      for (const f of fields) {
        if (updates[f] !== undefined) allowed[f] = updates[f];
      }
      const { data, error } = await client
        .from("follow_up_jobs")
        .update(allowed)
        .eq("id", jobId)
        .ilike("owner_email", normalized)
        .select("id, client_name, client_contact, service_name, service_date, notes, review_link, rebooking_link, status, created_at, updated_at")
        .single();
      if (error) throw error;
      return data;
    },

    async countActiveJobs(email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { count, error } = await client
        .from("follow_up_jobs")
        .select("id", { count: "exact", head: true })
        .ilike("owner_email", normalized)
        .eq("status", "active");
      if (error) throw error;
      return count || 0;
    },
  };
}

exports.createServiceRoleClient      = createServiceRoleClient;
exports.createEntitlementStore       = createEntitlementStore;
exports.createAvailabilityStore      = createAvailabilityStore;
exports.createAppointmentStore       = createAppointmentStore;
exports.createBusinessProfileStore   = createBusinessProfileStore;
exports.createPushSubscriptionStore  = createPushSubscriptionStore;
exports.createPublicBookingStore     = createPublicBookingStore;
exports.createFollowUpStore          = createFollowUpStore;
