const ONESIGNAL_API = "https://onesignal.com/api/v1";

async function sendPushToUser(externalUserId, { title, body, data = {} }) {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return { skipped: true, reason: "not_configured" };

  let res;
  try {
    res = await fetch(`${ONESIGNAL_API}/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_external_user_ids: [externalUserId],
        headings: { en: title },
        contents: { en: body },
        data,
        target_channel: "push",
      }),
    });
  } catch (fetchErr) {
    console.error("[onesignal] fetch failed:", fetchErr.message);
    return { ok: false, error: "fetch_failed" };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[onesignal] send failed (${res.status}):`, errText);
    return { ok: false, status: res.status };
  }

  const json = await res.json().catch(() => ({}));
  return { ok: true, id: json.id, recipients: json.recipients };
}

module.exports = { sendPushToUser };
