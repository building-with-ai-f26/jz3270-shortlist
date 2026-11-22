// Reading an uploaded resume on the hosted site. Same rules as the laptop app (rule 9): the file is read in
// memory and never kept, contact details are removed, and only the cleaned text is saved, encrypted. On top of
// that, the file must really be what its name says (a PDF starts with "%PDF", a Word file is a zip), so a
// renamed file of another kind is refused before any reader touches it.
import { extractText, cleanResume, fileKind } from "../resume.js";
import { HttpError } from "./http.js";

// Vercel accepts request bodies up to 4.5 MB; resumes are far smaller.
export const MAX_UPLOAD = 4 * 1024 * 1024;
export const MAX_RESUME_CHARS = 20000;
export const MIN_RESUME_CHARS = 200;
// A per-person rate limit on uploads, from the time of their last one.
export const UPLOAD_GAP_SECONDS = 10;

export function safeFileName(raw = "") {
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* keep as sent */ }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>"]/g, "").trim();
  return name.slice(-120) || "resume";
}

export function looksLike(kind, buffer) {
  if (kind === "pdf") return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  if (kind === "docx") return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (kind === "text") return !buffer.includes(0);
  return false;
}

export async function readUpload(buffer, fileName) {
  if (!buffer.length) throw new HttpError("That file is empty.");
  if (buffer.length > MAX_UPLOAD) throw new HttpError("That file is over 4 MB. Save a smaller PDF or the Word version.", 413);
  const kind = fileKind(fileName);
  if (!kind) throw new HttpError("Use a PDF, Word (.docx) or text file.", 415);
  if (!looksLike(kind, buffer)) throw new HttpError(`That file does not look like a real ${kind === "docx" ? "Word" : kind.toUpperCase()} file.`, 415);
  let text;
  try {
    text = await extractText(buffer, fileName);
  } catch {
    throw new HttpError("Shortlist could not read that file. Try the PDF or Word version.", 422);
  }
  const cleaned = cleanResume(text).slice(0, MAX_RESUME_CHARS);
  if (cleaned.length < MIN_RESUME_CHARS) {
    throw new HttpError("There is almost no text in that file. A scanned PDF is a picture; upload the Word version or a PDF saved from it.", 422);
  }
  return cleaned;
}
