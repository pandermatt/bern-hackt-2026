/**
 * `PushManager.subscribe` takes `applicationServerKey` as bytes, but a VAPID
 * public key travels as base64url text — so every push implementation carries
 * this conversion. Kept in its own module because it is the one piece of the
 * push flow that runs in the browser and must not pull `lib/push.ts` (and with
 * it `web-push` and the database) anywhere near the client bundle.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  // base64url swaps two characters and drops the padding; atob wants neither.
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");

  const raw = atob(base64);
  /*
   * Backed by an explicit ArrayBuffer, not the `new Uint8Array(length)`
   * shorthand. Since TS 5.7 the shorthand is typed `Uint8Array<ArrayBufferLike>`,
   * which includes SharedArrayBuffer and so is not assignable to
   * `applicationServerKey`'s `BufferSource`. Same bytes, narrower type.
   */
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
