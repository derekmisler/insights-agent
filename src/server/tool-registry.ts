import { z } from "zod";

export const tools = {
  weather: {
    description: "Fetch current weather for a given city",
    parameters: z.object({ location: z.string() }),
    execute: async ({ location }: { location: string }) => {
      const res = await fetch(
        `https://wttr.in/${encodeURIComponent(location)}?format=3`
      );
      return await res.text();
    },
  },
  echo: {
    description: "Echo the input string",
    parameters: z.object({ text: z.string() }),
    execute: async ({ text }: { text: string }) => text,
  },
  search: {
    description: "Search DuckDuckGo for a query",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }: { query: string }) => {
      const r = await fetch(
        `https://api.duckduckgo.com/?q=${query}&format=json`
      );
      return JSON.stringify(await r.json(), null, 2);
    },
  },
  externalApi: {
    description: "Call a protected API",
    parameters: z.object({
      url: z.url(),
      token: z.string(),
    }),
    execute: async ({ url, token }: { url: string; token: string }) => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API call failed: ${res.status}`);
      return await res.text();
    },
  },
};

export type ToolRegistry = typeof tools;
