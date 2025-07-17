import { z } from 'zod';

const schema = z.object({
  url: z.string().url(),
  token: z.string(),
});

export async function callApiTool({ url, token }: z.infer<typeof schema>) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`API call failed: ${res.status} ${msg}`);
  }
  const data = await res.json();
  return JSON.stringify(data, null, 2);
}
