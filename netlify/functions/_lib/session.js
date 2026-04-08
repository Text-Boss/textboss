const crypto = require("node:crypto");

const COOKIE_NAME = "textboss_session";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.TEXTBOSS_SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing TEXTBOSS_SESSION_SECRET");
  }

  return secret;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function serializeCookieValue(session) {
  const now = Date.now();
  return JSON.stringify({
    email: session.email,
    tier: session.tier,
    iat: now,
    exp: now + THIRTY_DAYS_MS,
  });
}

function extractCookieValue(headers) {
  const cookieHeader = headers.cookie || headers.Cookie || "";
  const parts = cookieHeader.split(/;\s*/);

  for (const part of parts) {
    const [name, ...rest] = part.split("=");
    if (name === COOKIE_NAME) {
      return rest.join("=");
    }
  }

  return "";
}

function createSessionCookie(session) {
  const payload = base64UrlEncode(serializeCookieValue(session));
  const signature = sign(payload);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Math.floor(THIRTY_DAYS_MS / 1000)}`;
}

function verifySessionCookie(headers) {
  const raw = extractCookieValue(headers);
  if (!raw) {
    return { ok: false, reason: "missing_session" };
  }

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) {
    return { ok: false, reason: "invalid_session" };
  }

  const expected = sign(payload);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return { ok: false, reason: "invalid_session" };
  }

  let session;
  try {
    session = JSON.parse(base64UrlDecode(payload));
  } catch {
    return { ok: false, reason: "invalid_session" };
  }

  if (!session.exp || Date.now() > session.exp) {
    return { ok: false, reason: "expired_session" };
  }

  return {
    ok: true,
    session: {
      email: session.email,
      tier: session.tier,
      iat: session.iat,
      exp: session.exp,
    },
  };
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

exports.COOKIE_NAME = COOKIE_NAME;
exports.createSessionCookie = createSessionCookie;
exports.verifySessionCookie = verifySessionCookie;
exports.clearSessionCookie = clearSessionCookie;
