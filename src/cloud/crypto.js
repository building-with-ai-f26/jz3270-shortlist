// Resumes are stored encrypted (CLOUD-PLAN.md, Security). AES-256-GCM with Node's own crypto, no package:
// a random 12-byte nonce per save, and the person's user id as "additional data", so a stored resume only opens
// for the account it belongs to; copied into another person's row, it fails to decrypt instead of leaking.
// The key is RESUME_ENCRYPTION_KEY: 32 random bytes in base64, one for Preview and a different one for
// Production, kept only in Vercel. The database alone, or a backup of it, cannot read a resume.
import crypto from "node:crypto";

const VERSION = "v1";

export function encryptionKey(env = process.env) {
  const raw = (env.RESUME_ENCRYPTION_KEY || "").trim();
  const key = raw ? Buffer.from(raw, "base64") : null;
  if (!key || key.length !== 32) throw new Error("RESUME_ENCRYPTION_KEY is missing or is not 32 bytes in base64.");
  return key;
}

export function encryptResume(text, userId, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(String(userId), "utf8"));
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptResume(stored, userId, key) {
  const [version, iv, tag, data] = String(stored || "").split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("This stored resume is not in a format Shortlist can read.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(String(userId), "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
