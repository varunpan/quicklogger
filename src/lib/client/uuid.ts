/** Client submission id for the server's duplicate guard. `crypto.randomUUID`
 *  where available (secure contexts); a time + random fallback otherwise
 *  (plain-HTTP LAN installs). Shared by Log Fuel and Log Odometer. */
export function genUuid(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
