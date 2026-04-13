const { json } = require('./_lib/http');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Valid email required' });
  }

  const pubId  = process.env.BEEHIIV_PUBLICATION_ID;
  const apiKey = process.env.BEEHIIV_API_KEY;

  if (!pubId || !apiKey) {
    console.error('subscribe: BEEHIIV_PUBLICATION_ID or BEEHIIV_API_KEY not set');
    return json(500, { error: 'Subscription service not configured' });
  }

  let res;
  try {
    res = await fetch(
      `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          email,
          reactivate_existing: false,
          send_welcome_email: true,
          tags: ['lead-magnet-playbook'],
        }),
      }
    );
  } catch (err) {
    console.error('subscribe: network error calling Beehiiv', err);
    return json(502, { error: 'Could not reach subscription service' });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('subscribe: Beehiiv returned', res.status, body);
    return json(502, { error: 'Subscription failed' });
  }

  return json(200, { ok: true });
};
