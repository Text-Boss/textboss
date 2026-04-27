"use strict";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function extractTextContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

function createAnthropicClient(options = {}) {
  const apiKey = options.apiKey || getRequiredEnv("ANTHROPIC_API_KEY");
  const model = options.model || process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
  const fetchImpl = options.fetchImpl || fetch;

  async function callMessages(body) {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status}`);
    }

    return response.json();
  }

  return {
    callMessages,

    async createResponse({ tier, message, conversation, policy, extraSystemContext }) {
      const systemParts = [`Tier: ${tier}`, policy.instructions];
      if (extraSystemContext) systemParts.push(extraSystemContext);
      const system = systemParts.join("\n\n");

      const messages = [
        ...conversation.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
      ];

      const data = await callMessages({
        model,
        system,
        messages,
        max_tokens: policy.responseMaxTokens,
      });

      return {
        output: extractTextContent(data.content),
        usage: data.usage,
      };
    },
  };
}

exports.createAnthropicClient = createAnthropicClient;
exports.extractTextContent = extractTextContent;
