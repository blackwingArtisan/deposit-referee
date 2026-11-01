/** Reads a text/plain streaming response (from textStreamResponse) chunk by chunk. */
export async function readTextStream(res: Response, onText: (full: string, delta: string) => void): Promise<string> {
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const delta = decoder.decode(value, { stream: true });
    full += delta;
    onText(full, delta);
  }
  return full;
}
