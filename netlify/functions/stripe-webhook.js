const Stripe = require("stripe");

exports.handler = async (event) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const sig =
    event.headers["stripe-signature"] ||
    event.headers["Stripe-Signature"];

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  return {
    statusCode: 200,
    body: "Verified"
  };
};
