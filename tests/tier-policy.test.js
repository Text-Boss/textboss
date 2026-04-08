const assert = require("node:assert/strict");

async function testBlackPolicyHasHighestRestraint() {
  const { getTierPolicy } = require("../netlify/functions/_lib/tier-policy");

  const core = getTierPolicy("Core");
  const black = getTierPolicy("Black");

  assert.equal(core.tier, "Core");
  assert.equal(black.tier, "Black");
  assert.ok(black.responseMaxTokens > core.responseMaxTokens);
  assert.match(black.instructions, /screenshot-safe and legally defensible/i);
}

async function testUnknownTierThrows() {
  const { getTierPolicy } = require("../netlify/functions/_lib/tier-policy");

  assert.throws(() => getTierPolicy("Unknown"), /Unknown tier/);
}

async function testNormalizeTierCanonicalizesWhitespaceAndCase() {
  const { normalizeTier } = require("../netlify/functions/_lib/tier-policy");

  assert.equal(normalizeTier(" core "), "Core");
  assert.equal(normalizeTier("PRO"), "Pro");
  assert.equal(normalizeTier(" Black "), "Black");
  assert.equal(normalizeTier("Enterprise"), "");
}

async function run() {
  await testBlackPolicyHasHighestRestraint();
  await testUnknownTierThrows();
  await testNormalizeTierCanonicalizesWhitespaceAndCase();
  console.log("tier policy tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
