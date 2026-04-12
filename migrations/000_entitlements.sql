-- 000: Entitlements table
-- Core auth table — populated by Stripe webhook on checkout.session.completed
-- and updated on subscription changes. Queried on every request by verify-email,
-- session-verify, chat, and schedule-chat.

CREATE TABLE IF NOT EXISTS entitlements (
  email                   text        PRIMARY KEY,
  entitled_tier           text        NOT NULL,
  subscription_status     text        NOT NULL DEFAULT 'active',
  current_period_end      timestamptz,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  price_id                text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entitlements_stripe_customer
  ON entitlements (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entitlements_stripe_subscription
  ON entitlements (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
