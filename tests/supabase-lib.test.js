const assert = require("node:assert/strict");

async function testFindEntitlementByEmailNormalizesLookup() {
  const { createEntitlementStore } = require("../netlify/functions/_lib/supabase");

  let queriedEmail = null;
  let queryMethod = null;
  const store = createEntitlementStore({
    client: {
      from(table) {
        assert.equal(table, "entitlements");
        return {
          select() {
            return {
              ilike(column, email) {
                assert.equal(column, "email");
                queryMethod = "ilike";
                queriedEmail = email;
                return {
                  maybeSingle: async () => ({
                    data: {
                      email,
                      entitled_tier: "Core",
                      subscription_status: "active",
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    },
  });

  const entitlement = await store.findEntitlementByEmail("Core@Example.com");

  assert.equal(queryMethod, "ilike");
  assert.equal(queriedEmail, "core@example.com");
  assert.equal(entitlement.entitled_tier, "Core");
}

async function run() {
  await testFindEntitlementByEmailNormalizesLookup();
  console.log("supabase helper tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
