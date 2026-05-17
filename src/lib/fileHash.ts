import { sha256 } from "js-sha256";

// SHA-256 with a graceful fallback. `crypto.subtle` requires a Secure Context
// (HTTPS or localhost). In LAN HTTP deployments it is `undefined`, so we fall
// back to a pure-JS implementation.
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const subtle = (globalThis as any).crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    try {
      const digest = await subtle.digest("SHA-256", buf);
      const bytes = new Uint8Array(digest);
      let out = "";
      for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, "0");
      }
      return out;
    } catch {
      // fall through to JS fallback
    }
  }
  return sha256(buf);
}