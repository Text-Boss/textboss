const assert = require("node:assert/strict");

function withEnv(name, value, fn) {
  const previous = process.env[name];
  process.env[name] = value;

  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

async function testSignedCookieRoundTrip() {
  const sessionLib = require("../netlify/functions/_lib/session");

  await withEnv("TEXTBOSS_SESSION_SECRET", "test-secret", () => {
    const cookie = sessionLib.createSessionCookie({
      email: "core@example.com",
      tier: "Core",
    });

    assert.match(cookie, /^textboss_session=/);

    const verification = sessionLib.verifySessionCookie({
      cookie,
    });

    assert.equal(verification.ok, true);
    assert.equal(verification.session.email, "core@example.com");
    assert.equal(verification.session.tier, "Core");
  });
}

async function testTamperedCookieDenied() {
  const sessionLib = require("../netlify/functions/_lib/session");

  await withEnv("TEXTBOSS_SESSION_SECRET", "test-secret", () => {
    const cookie = sessionLib.createSessionCookie({
      email: "pro@example.com",
      tier: "Pro",
    });

    const [prefix, remainder] = cookie.split("=");
    const [value, ...attributes] = remainder.split("; ");
    const [payload, signature] = value.split(".");
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    const tampered = `${prefix}=${tamperedPayload}.${signature}; ${attributes.join("; ")}`;
    const verification = sessionLib.verifySessionCookie({
      cookie: tampered,
    });

    assert.deepEqual(verification, {
      ok: false,
      reason: "invalid_session",
    });
  });
}

async function run() {
  await testSignedCookieRoundTrip();
  await testTamperedCookieDenied();
  console.log("session helper tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
