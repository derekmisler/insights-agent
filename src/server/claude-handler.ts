import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { tools } from './tool-registry';
dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function streamClaudeResponse(prompt: string, res: Response) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const toolInstructions = Object.entries(tools).map(
    ([name, { description, parameters }]) =>
      \`Tool: \${name}\nDescription: \${description}\nParameters: \${parameters.toString()}\`
  ).join('\n\n');

  const systemPrompt = \`You are a smart assistant. If a user asks something that requires a tool, respond in JSON with:
{
  "tool": "toolName",
  "parameters": { ... }
}
Otherwise, respond normally.\`;

  const stream = anthropic.messages.stream({
    model: 'claude-3-5-sonnet-20240229',
    stream: true,
    max_tokens: 512,
    messages: [
      { role: 'system', content: \`\${systemPrompt}\n\n\${toolInstructions}\` },
      { role: 'user', content: prompt },
    ],
  });

  let captured = '';
  for await (const part of stream) {
    if (part.type === 'content_block_delta' && part.delta?.text) {
      captured += part.delta.text;
      await writer.write(encoder.encode(part.delta.text));
    }
  }

  try {
    const match = captured.match(/\{\s*"tool"\s*:\s*"(.*?)".*?"parameters"\s*:\s*(\{.*\})\s*\}/s);
    if (match) {
      const [, toolName, paramStr] = match;
      if (tools[toolName]) {
        const parsed = tools[toolName].parameters.safeParse(JSON.parse(paramStr));
        if (parsed.success) {
          const result = await tools[toolName].execute(parsed.data);
          await writer.write(encoder.encode(`\n\n(Tool: \${toolName} Result)\n\${result}`));
        } else {
          await writer.write(encoder.encode(`\n(Invalid parameters for tool '\${toolName}')`));
        }
      } else {
        await writer.write(encoder.encode(`\n(Unknown tool '\${toolName}')`));
      }
    }
  } catch (err) {
    await writer.write(encoder.encode(`\n(Error parsing tool response: \${String(err)})`));
  }

  await writer.close();
  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
