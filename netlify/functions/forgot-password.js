const crypto = require("node:crypto");
const { createEntitlementStore, createPasswordResetTokenStore } = require("./_lib/supabase");
const { json } = require("./_lib/http");

function createHandler(deps) {
  const { findEntitlementByEmail, deleteTokensByEmail, createToken, sendEmail } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
    }

    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; } catch {
      return json(400, { ok: false, denied: true, reason: "invalid_json" });
    }

    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return json(400, { ok: false, denied: true, reason: "missing_email" });

    // Always return success — never reveal whether email is on file
    try {
      const entitlement = await findEntitlementByEmail(email);
      if (entitlement) {
        const token     = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await deleteTokensByEmail(email);
        await createToken(email, token, expiresAt);
        await sendEmail(email, token);
      }
    } catch (err) {
      console.error("[forgot-password] error:", err?.message || err);
      // Still return success
    }

    return json(200, { ok: true });
  };
}

function createRuntimeHandler(overrides = {}) {
  let entitlementStore, tokenStore;
  try {
    entitlementStore = overrides.entitlementStore || createEntitlementStore();
    tokenStore       = overrides.tokenStore       || createPasswordResetTokenStore();
  } catch (err) {
    console.error("[forgot-password] store init failed:", err);
    return async () => json(500, { ok: false, denied: true, reason: "store_init_failed" });
  }

  const { Resend } = require("resend");

  return createHandler({
    findEntitlementByEmail: (email) => entitlementStore.findEntitlementByEmail(email),
    deleteTokensByEmail:    (email) => tokenStore.deleteTokensByEmail(email),
    createToken:            (email, token, expiresAt) => tokenStore.createToken(email, token, expiresAt),
    sendEmail: async (email, token) => {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const resetUrl = `https://textboss.com.au/reset-password.html?token=${token}`;
      await resend.emails.send({
        from:    "Text Boss <onboarding@resend.dev>",
        to:      email,
        subject: "Reset your Text Boss password",
        html: `
          <div style="font-family:monospace;background:#020203;color:#e4ecf2;padding:32px;max-width:480px;margin:0 auto;border-radius:12px">
            <p style="color:#22c55e;font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:12px;margin:0 0 16px">TEXT BOSS</p>
            <h2 style="margin:0 0 16px;font-size:20px">Reset your password</h2>
            <p style="color:#8896a4;line-height:1.6;margin:0 0 24px">Click the button below to set a new password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#22c55e;color:#040e07;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-family:monospace">Reset password</a>
            <p style="color:#52606d;font-size:12px;margin:24px 0 0">If you didn't request this, ignore this email — your password won't change.</p>
          </div>
        `,
      });
    },
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[forgot-password] unhandled error:", err?.message || err);
    return json(500, { ok: false, denied: true, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
