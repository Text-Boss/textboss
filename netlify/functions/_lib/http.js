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

function denied(statusCode, reason, headers = {}) {
  return json(
    statusCode,
    {
      ok: false,
      denied: true,
      reason,
    },
    headers
  );
}

exports.json = json;
exports.denied = denied;
