// UUID v4 with fallbacks. `crypto.randomUUID` requires a Secure Context in
// some browsers (HTTPS or localhost). `crypto.getRandomValues` is available
// in insecure contexts as well, so we prefer it as a fallback.
export function randomUUID(): string {
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c && typeof (c as any).randomUUID === "function") {
    try {
      return (c as any).randomUUID();
    } catch {
      // fall through
    }
  }
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  // Last-resort fallback (non-cryptographic).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}