import { useState } from 'react';
import { callClaudeStream } from '../agent';

export function Chat() {
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);

  const send = async () => {
    setChat((prev) => [...prev, `You: ${input}`, `Claude: `]);
    setStreaming(true);

    let response = "";
    await callClaudeStream(input, (token) => {
      response += token;
      setChat((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = `Claude: ${response}`;
        return updated;
      });
    });

    setStreaming(false);
    setInput("");
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: 16 }}>
        {chat.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>
      <input
        disabled={streaming}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{ width: "70%", marginRight: 10 }}
      />
      <button onClick={send} disabled={streaming || !input}>
        Send
      </button>
    </div>
  );
}
