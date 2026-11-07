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
