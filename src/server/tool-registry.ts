import { z } from 'zod';

export const tools = {
  weather: {
    description: 'Fetch current weather for a given city',
    parameters: z.object({ location: z.string() }),
    execute: async ({ location }: { location: string }) => {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=3`);
      return await res.text();
    },
  },
  echo: {
    description: 'Echo the input string',
    parameters: z.object({ text: z.string() }),
    execute: async ({ text }: { text: string }) => text,
  },
};

export type ToolRegistry = typeof tools;
