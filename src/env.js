// I load .env by hand so the project needs zero npm packages.
// Real environment variables win over the file, so a key set in the shell is never overwritten.
import fs from "node:fs";
import path from "node:path";

export function loadEnv(rootDir) {
  const file = path.join(rootDir, ".env");
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// I treat the template placeholder as "no key" so the app falls back to keyword scoring
// instead of sending a fake key to OpenRouter and failing on every posting.
export function hasRealKey() {
  const key = process.env.OPENROUTER_API_KEY || "";
  return key.length > 20 && !key.includes("replace-with-your-key");
}

// Setup lets the user paste their key in the browser instead of editing .env.
// The key only goes to .env (gitignored) and to OpenRouter's key check. It is never sent back to the page or logged.
const KEY_FORMAT = /^sk-or-[A-Za-z0-9_-]{20,200}$/;
const KEY_LINE = /^[ \t]*OPENROUTER_API_KEY[ \t]*=.*$/m;

// Replaces the key line in the text of a .env file, or adds one, and leaves every other line alone.
export function withEnvKey(envText, key) {
  const line = `OPENROUTER_API_KEY=${key}`;
  if (KEY_LINE.test(envText)) return envText.replace(KEY_LINE, line);
  return `${envText.replace(/\n*$/, envText ? "\n" : "")}${line}\n`;
}

// Asks OpenRouter whether it knows the key. This reads the key's own details and costs nothing.
// Only a clear "no" stops the save; if OpenRouter cannot be reached, the key is saved and the first check will tell.
export async function checkKey(key, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl("https://openrouter.ai/api/v1/key", { headers: { "Authorization": `Bearer ${key}` } });
  } catch {
    return { checked: false };
  }
  if (res.status === 401 || res.status === 403) throw new Error("OpenRouter did not accept that key. Copy it again from openrouter.ai/keys.");
  return { checked: res.ok };
}

export async function saveApiKey(key, rootDir, { fetchImpl = fetch } = {}) {
  const clean = String(key || "").trim();
  if (!KEY_FORMAT.test(clean)) throw new Error("That does not look like an OpenRouter key. It starts with sk-or-.");
  const result = await checkKey(clean, fetchImpl);
  const file = path.join(rootDir, ".env");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  fs.writeFileSync(file, withEnvKey(text, clean), { mode: 0o600 });
  process.env.OPENROUTER_API_KEY = clean;
  return result;
}
