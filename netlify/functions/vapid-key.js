const { json } = require('./_lib/http');

exports.handler = async () => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return json(503, { error: 'VAPID not configured' });
  return json(200, { key });
};
