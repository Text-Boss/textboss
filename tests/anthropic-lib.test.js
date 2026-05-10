const assert = require("node:assert/strict");

async function testAnthropicClientNormalizesOutput() {
  const { createAnthropicClient } = require("../netlify/functions/_lib/anthropic");

  const calls = [];
  const client = createAnthropicClient({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });

      return {
        ok: true,
        async json() {
          return {
            content: [{ type: "text", text: "Controlled answer" }],
            usage: { input_tokens: 10, output_tokens: 2 },
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
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(result.output, "Controlled answer");
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 2 });
}

async function testAnthropicClientJoinsMultipleTextBlocks() {
  const { createAnthropicClient } = require("../netlify/functions/_lib/anthropic");

  const client = createAnthropicClient({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          content: [
            { type: "text", text: "First line." },
            { type: "thinking", thinking: "internal reasoning" },
            { type: "text", text: " Second line." },
          ],
          usage: { input_tokens: 12, output_tokens: 3 },
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
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 3 });
}

async function testAnthropicClientSendsCorrectHeaders() {
  const { createAnthropicClient } = require("../netlify/functions/_lib/anthropic");

  let capturedHeaders;
  const client = createAnthropicClient({
    apiKey: "my-api-key",
    model: "claude-opus-4-7",
    fetchImpl: async (url, options) => {
      capturedHeaders = options.headers;
      return {
        ok: true,
        async json() {
          return { content: [{ type: "text", text: "ok" }], usage: {} };
        },
      };
    },
  });

  await client.createResponse({
    tier: "Pro",
    message: "test",
    conversation: [],
    policy: { instructions: "test", responseMaxTokens: 100 },
  });

  assert.equal(capturedHeaders["x-api-key"], "my-api-key");
  assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
  assert.equal(capturedHeaders["content-type"], "application/json");
}

async function run() {
  await testAnthropicClientNormalizesOutput();
  await testAnthropicClientJoinsMultipleTextBlocks();
  await testAnthropicClientSendsCorrectHeaders();
  console.log("anthropic helper tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
