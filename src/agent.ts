export async function callClaudeStream(
  userInput: string,
  onToken: (token: string) => void
): Promise<string> {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: userInput }),
  });

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let full = '';

  if (!reader) return '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    full += chunk;
    onToken(chunk);
  }

  return full;
}
