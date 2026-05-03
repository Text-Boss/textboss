const { json } = require("./_lib/http");

exports.handler = async () => {
  const appId = process.env.ONESIGNAL_APP_ID;
  if (!appId) return json(503, { error: "not_configured" });
  return json(200, { appId });
};
