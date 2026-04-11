function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) {
    return "";
  }

  return data.output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
}

function createResponsesClient(options = {}) {
  const apiKey = options.apiKey || getRequiredEnv("OPENAI_API_KEY");
  const model = options.model || getRequiredEnv("OPENAI_MODEL");
  const fetchImpl = options.fetchImpl || fetch;

  return {
    async createResponse({ tier, message, conversation, policy, extraSystemContext }) {
      const systemParts = [`Tier: ${tier}`, policy.instructions];
      if (extraSystemContext) {
        systemParts.push(extraSystemContext);
      }
      const instructions = systemParts.join("\n\n");

      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          instructions,
          input: [
            ...conversation,
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: message,
                },
              ],
            },
          ],
          max_output_tokens: policy.responseMaxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error("OpenAI request failed");
      }

      const data = await response.json();
      return {
        output: extractOutputText(data),
        usage: data.usage,
      };
    },
  };
}

exports.createResponsesClient = createResponsesClient;
