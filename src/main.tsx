import React from 'react';
import { createRoot } from 'react-dom/client';
import { Chat } from './components/Chat.js';

const root = createRoot(document.getElementById('root')!);
root.render(<Chat />);
