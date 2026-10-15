import crypto from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; the length itself isn't secret.
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hmacHex(secret: string, body: Buffer): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** GitHub sends `X-Hub-Signature-256: sha256=<hex hmac of raw body>`. */
export function verifyGithubSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header, `sha256=${hmacHex(secret, rawBody)}`);
}

/** Sentry sends `Sentry-Hook-Signature: <hex hmac of raw body>` using the integration's client secret. */
export function verifySentrySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  return safeEqual(header, hmacHex(secret, rawBody));
}

export function signGithub(body: string, secret: string): string {
  return `sha256=${hmacHex(secret, Buffer.from(body))}`;
}

export function signSentry(body: string, secret: string): string {
  return hmacHex(secret, Buffer.from(body));
}
