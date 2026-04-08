const sessionLib = require("./_lib/session");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function createHandler(deps) {
  const { clearSessionCookie } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false });
    }

    return json(
      200,
      { ok: true },
      { "set-cookie": clearSessionCookie() }
    );
  };
}

function notImplemented() {
  throw new Error("session-logout dependencies are not configured");
}

function createRuntimeHandler(overrides = {}) {
  const runtimeSessionLib = overrides.sessionLib || sessionLib;

  return createHandler({
    clearSessionCookie: () => runtimeSessionLib.clearSessionCookie(),
  });
}

async function handler(event, context) {
  const runtimeHandler = createRuntimeHandler();
  return runtimeHandler(event, context);
}

exports.createHandler = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler = handler;
