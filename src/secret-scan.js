// Finds secret keys in text (SECURITY.md, step 2 of the audit). Used by `npm run check-secrets` on the repo, its
// whole Git history and the live sites. It never prints a key: every hit is masked to its first few characters.
// The PostHog key (phc_) and the Supabase publishable key are public by design, so they are not searched for.

const PATTERNS = [
  { name: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: "OpenRouter key", re: /sk-or-[A-Za-z0-9_-]{20,}/g },
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI project key", re: /sk-proj-[A-Za-z0-9_-]{20,}/g },
  { name: "Stripe live key", re: /sk_live_[A-Za-z0-9]{16,}/g },
  { name: "Supabase service_role key", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, check: isServiceRoleJwt }
];

// The templates in .env.example and the tests use made-up values like "sk-or-v1-replace-with-your-key".
const PLACEHOLDER = /replace|your[-_]?key|example|x{6,}|never_share|oops|_test\b|fake/i;

function isServiceRoleJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function mask(value) {
  const keep = Math.min(12, Math.max(4, Math.floor(value.length / 4)));
  return `${value.slice(0, keep)}… (${value.length} characters)`;
}

// Returns [{ kind, masked, line }]. `ownKeys` are the real values from .env, searched for literally, so a key in a
// format no pattern knows still gets caught.
export function findSecrets(text, ownKeys = []) {
  const hits = [];
  const lines = String(text).split("\n");
  lines.forEach((line, i) => {
    for (const { name, re, check } of PATTERNS) {
      for (const match of line.matchAll(re)) {
        const value = match[0];
        if (PLACEHOLDER.test(value)) continue;
        if (check && !check(value)) continue;
        hits.push({ kind: name, masked: mask(value), line: i + 1 });
      }
    }
    for (const { name, value } of ownKeys) {
      if (value && line.includes(value)) hits.push({ kind: `your ${name}`, masked: mask(value), line: i + 1 });
    }
  });
  return hits;
}

// The secret values in .env worth searching for: anything named like a key, token, secret or password, except the
// two that are public on purpose.
const PUBLIC_ON_PURPOSE = new Set(["POSTHOG_KEY", "SUPABASE_PUBLISHABLE_KEY"]);
export function ownSecrets(env = {}) {
  return Object.entries(env)
    .filter(([name, value]) => /KEY|SECRET|TOKEN|PASSWORD/.test(name) && !PUBLIC_ON_PURPOSE.has(name))
    .filter(([, value]) => typeof value === "string" && value.length >= 16 && !PLACEHOLDER.test(value))
    .map(([name, value]) => ({ name, value }));
}
