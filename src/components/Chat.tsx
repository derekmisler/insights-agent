import React, { useState } from 'react';
import { callClaudeStream } from '../agent.js';

export function Chat() {
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);

  const send = async () => {
    if (!input.trim()) return;

    setChat(prev => [...prev, `You: ${input}`, `Claude: `]);
    setStreaming(true);

    let response = '';
    await callClaudeStream(input, token => {
      response += token;
      setChat(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = `Claude: ${response}`;
        return updated;
      });
    });

    setStreaming(false);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: '0 auto' }}>
      <h1>Claude Streaming Chat</h1>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          padding: '1rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
          height: '60vh',
          overflowY: 'auto',
          marginBottom: '1rem',
          fontFamily: 'monospace',
        }}
      >
        {chat.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>
      <input
        disabled={streaming}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask something..."
        style={{
          width: '80%',
          padding: '0.75rem',
          fontSize: '1rem',
          marginRight: '0.5rem',
        }}
      />
      <button
        onClick={send}
        disabled={streaming || !input.trim()}
        style={{
          padding: '0.75rem 1.25rem',
          fontSize: '1rem',
        }}
      >
        Send
      </button>
    </div>
  );
}