const assert = require("node:assert/strict");

async function testResponsesWrapperNormalizesOutput() {
  const { createResponsesClient } = require("../netlify/functions/_lib/openai");

  const calls = [];
  const client = createResponsesClient({
    apiKey: "test-key",
    model: "gpt-test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });

      return {
        ok: true,
        async json() {
          return {
            output_text: "Controlled answer",
            usage: { total_tokens: 12 },
          };
        },
      };
    },
  });

  const result = await client.createResponse({
    tier: "Core",
    message: "Help me respond",
    conversation: [],
    policy: {
      instructions: "core-policy",
      responseMaxTokens: 300,
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(result.output, "Controlled answer");
  assert.deepEqual(result.usage, { total_tokens: 12 });
}

async function testResponsesWrapperFallsBackToOutputContent() {
  const { createResponsesClient } = require("../netlify/functions/_lib/openai");

  const client = createResponsesClient({
    apiKey: "test-key",
    model: "gpt-test",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: "First line.",
                },
                {
                  type: "output_text",
                  text: " Second line.",
                },
              ],
            },
          ],
          usage: { total_tokens: 15 },
        };
      },
    }),
  });

  const result = await client.createResponse({
    tier: "Black",
    message: "Contain the response",
    conversation: [],
    policy: {
      instructions: "black-policy",
      responseMaxTokens: 300,
    },
  });

  assert.equal(result.output, "First line. Second line.");
  assert.deepEqual(result.usage, { total_tokens: 15 });
}

async function run() {
  await testResponsesWrapperNormalizesOutput();
  await testResponsesWrapperFallsBackToOutputContent();
  console.log("openai helper tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
