// Resume upload: read a PDF, Word or text file, strip contact details, and swap it into data/profile.md
// while keeping the "What I'm looking for" section the user wrote. The old profile is kept as a backup.
import fs from "node:fs";
import path from "node:path";

export const MAX_BYTES = 10 * 1024 * 1024;
export const LOOKING_FOR = /^##\s*what i'?m looking for\s*$/im;

export function fileKind(filename = "") {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if ([".txt", ".md", ".markdown"].includes(ext)) return "text";
  return null;
}

export async function extractText(buffer, filename) {
  const kind = fileKind(filename);
  if (!kind) throw new Error("Use a PDF, Word (.docx) or text file.");
  if (kind === "text") return buffer.toString("utf8");

  if (kind === "pdf") {
    // unpdf's PDF reader needs Node 22 or newer. Word and text uploads work on any version.
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 22) throw new Error(`Reading PDFs needs Node 22 or newer, and this computer has Node ${process.versions.node}. Install the current Node from nodejs.org, or upload the Word version.`);
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false });
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }

  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

// Every scoring call sends the profile to the model, which does not need my phone number or email.
// I remove emails, phone numbers and web links, and tidy the whitespace PDFs leave behind.
export function cleanResume(text) {
  return (text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "")
    .replace(/\b(https?:\/\/|www\.)\S+/gi, "")
    .replace(/\blinkedin\.com\/\S+/gi, "")
    .replace(/[ \t]*\|[ \t]*(\|[ \t]*)+/g, " | ")
    .replace(/(^|\n)[ \t|]+/g, "$1")
    .replace(/[ \t|]+(\n|$)/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Keeps the user's "What I'm looking for" section and replaces everything above it with the new resume.
export function mergeProfile(oldProfile, resumeText) {
  const m = (oldProfile || "").match(LOOKING_FOR);
  const wants = m ? oldProfile.slice(m.index).trim() : "## What I'm looking for\n\n(Write a few sentences on the roles, locations and dealbreakers you care about.)";
  return `# Profile\n\n## Resume\n\n${resumeText.trim()}\n\n${wants}\n`;
}

export async function saveResume(buffer, filename, dataDir) {
  if (!buffer?.length) throw new Error("The file was empty.");
  if (buffer.length > MAX_BYTES) throw new Error("That file is over 10 MB. Export a smaller PDF and try again.");

  const text = cleanResume(await extractText(buffer, filename));
  if (text.length < 200) throw new Error("Could not read enough text from that file. If it is a scanned image, export a text-based PDF instead.");

  fs.mkdirSync(dataDir, { recursive: true });
  const profilePath = path.join(dataDir, "profile.md");
  const old = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf8") : "";
  if (old) fs.writeFileSync(path.join(dataDir, "profile.previous.md"), old);
  fs.writeFileSync(profilePath, mergeProfile(old, text));

  const meta = { fileName: path.basename(filename), uploadedAt: new Date().toISOString(), chars: text.length };
  fs.writeFileSync(path.join(dataDir, "resume.json"), JSON.stringify(meta, null, 2));
  return meta;
}

export function readResumeMeta(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "resume.json"), "utf8")); } catch { return null; }
}
