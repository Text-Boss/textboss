"use strict";

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("04") && digits.length === 10) return "61" + digits.slice(1);
  if (digits.length >= 7) return digits;
  return null;
}

async function sendSms({ to, body }) {
  const username = process.env.MOBILEMESSAGE_USERNAME;
  const password = process.env.MOBILEMESSAGE_PASSWORD;
  const sender   = process.env.MOBILEMESSAGE_SENDER || "TEXT BOSS";
  if (!username || !password) return;
  const normalized = normalizePhone(to);
  if (!normalized || !body) return;
  const res = await fetch("https://api.mobilemessage.com.au/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
    body: JSON.stringify({ messages: [{ to: normalized, message: body, sender }] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SMS failed ${res.status}: ${text}`);
  }
  return res.json();
}

module.exports = { sendSms, normalizePhone };
