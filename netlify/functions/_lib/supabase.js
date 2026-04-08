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

exports.createServiceRoleClient = createServiceRoleClient;
exports.createEntitlementStore  = createEntitlementStore;
exports.createAvailabilityStore = createAvailabilityStore;
exports.createAppointmentStore  = createAppointmentStore;
