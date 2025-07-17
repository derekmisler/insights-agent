import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callClaudeStream(
  text: string,
  onToken: (token: string) => void
) {
  const stream = anthropic.messages.stream({
    model: "claude-3-5-sonnet-20240229",
    max_tokens: 1024,
    stream: true,
    messages: [{ role: "user", content: text }],
  });

  let result = "";
  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      result += chunk.delta.text;
      onToken(chunk.delta.text);
    }
  }

  return result;
}
