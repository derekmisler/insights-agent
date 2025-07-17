import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { tools } from "./tool-registry.js";

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function streamClaudeResponse(
  prompt: string,
  _res: Response
): Promise<Response> {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const systemPrompt = `You are a helpful AI assistant. You may use tools when appropriate. If you need to use a tool, respond in this JSON format only:

{
  "tool": "toolName",
  "parameters": { ... }
}

Available tools:
${Object.entries(tools)
  .map(
    ([name, { description, parameters }]) =>
      `Tool: ${name}\nDescription: ${description}\nParameters: ${parameters.toString()}`
  )
  .join("\n\n")}
`;

  const stream = anthropic.messages.stream({
    model: "claude-3-5-haiku-20241022",
    stream: true,
    max_tokens: 512,
    temperature: 0.2,
    messages: [
      { role: "assistant", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });

  let fullText = "";

  for await (const part of stream) {
    if (part.type === "content_block_delta" && part.delta?.text) {
      const chunk = part.delta.text;
      fullText += chunk;
      await writer.write(encoder.encode(chunk));
    }
  }

  // After full output, try parsing tool JSON
  const match = fullText.match(
    /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[\s\S]*?\})\s*\}/
  );

  if (match) {
    const [_, toolName, paramStr] = match;

    if (toolName in tools) {
      try {
        const tool = tools[toolName as keyof typeof tools];
        const parsed = tool.parameters.safeParse(JSON.parse(paramStr));

        if (parsed.success) {
          const result = await tool.execute(parsed.data);
          await writer.write(
            encoder.encode(`\n\n(Tool Output from "${toolName}"):\n${result}`)
          );
        } else {
          await writer.write(
            encoder.encode(`\n\n⚠️ Invalid parameters for tool "${toolName}".`)
          );
        }
      } catch (err) {
        await writer.write(
          encoder.encode(
            `\n\n⚠️ Error running tool "${toolName}": ${String(err)}`
          )
        );
      }
    } else {
      await writer.write(encoder.encode(`\n\n⚠️ Unknown tool "${toolName}".`));
    }
  }

  await writer.close();
  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
