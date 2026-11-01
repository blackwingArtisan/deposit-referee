/**
 * Process-wide singletons that survive Next.js dev hot reloads (module re-evaluation).
 * Use for in-memory state shared by route handlers: event bus, approvals, mock PayPal.
 */
const registry = globalThis as unknown as { __kitSingletons?: Map<string, unknown> };

export function singleton<T>(key: string, create: () => T): T {
  registry.__kitSingletons ??= new Map();
  if (!registry.__kitSingletons.has(key)) registry.__kitSingletons.set(key, create());
  return registry.__kitSingletons.get(key) as T;
}

/** Tests only. */
export function resetSingletons(prefix?: string) {
  if (!registry.__kitSingletons) return;
  for (const key of [...registry.__kitSingletons.keys()]) {
    if (!prefix || key.startsWith(prefix)) registry.__kitSingletons.delete(key);
  }
}
