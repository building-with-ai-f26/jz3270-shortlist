// Reading an uploaded resume on the hosted site. Same rules as the laptop app (rule 9): the file is read in
// memory and never kept, contact details are removed, and only the cleaned text is saved, encrypted. On top of
// that, every upload is bounded before any reader touches it, so one file cannot stall or exhaust a server:
//   - the file must really be what its name says (a PDF starts with "%PDF", a Word file is a zip);
//   - text files are at most 200 KB, PDFs at most 20 pages;
//   - a Word file is unzipped here first, with a hard cap on how much it may expand, so a "zip bomb" is refused
//     before the Word reader runs (the cap counts real bytes, not the sizes the file claims);
//   - text is trimmed before cleaning, since cleaning time grows quickly with length.
import zlib from "node:zlib";
import { extractText, cleanResume, fileKind } from "../resume.js";
import { HttpError } from "./http.js";

// Vercel accepts request bodies up to 4.5 MB; resumes are far smaller.
export const MAX_UPLOAD = 4 * 1024 * 1024;
export const MAX_TEXT_FILE = 200 * 1024;
export const MAX_PDF_PAGES = 20;
export const MAX_DOCX_EXPANDED = 40 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2000;
const MAX_RAW_CHARS = 40000;
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

// Walks the zip's own table of contents and inflates every entry with a running cap on real output bytes.
// Returns null when the file is safe to hand to the Word reader, or a reason when it is not.
export function docxProblem(buffer, maxExpanded = MAX_DOCX_EXPANDED) {
  const END = 0x06054b50, ENTRY = 0x02014b50, LOCAL = 0x04034b50;
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === END) { end = i; break; }
  }
  if (end < 0) return "not a complete Word file";
  const entries = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  if (entries > MAX_DOCX_ENTRIES || at >= buffer.length) return "too many parts";
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== ENTRY) return "a damaged table of contents";
    const method = buffer.readUInt16LE(at + 10);
    const packed = buffer.readUInt32LE(at + 20);
    const local = buffer.readUInt32LE(at + 42);
    at += 46 + buffer.readUInt16LE(at + 28) + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL) return "a damaged part";
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (packed === 0xffffffff || start + packed > buffer.length) return "a part larger than the file";
    const data = buffer.subarray(start, start + packed);
    if (method === 0) total += data.length;
    else if (method === 8) {
      try {
        total += zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, maxExpanded - total + 1) }).length;
      } catch {
        return "parts that expand too far";
      }
    } else return "an unusual compression method";
    if (total > maxExpanded) return "parts that expand too far";
  }
  return null;
}

export async function readUpload(buffer, fileName) {
  if (!buffer.length) throw new HttpError("That file is empty.");
  if (buffer.length > MAX_UPLOAD) throw new HttpError("That file is over 4 MB. Save a smaller PDF or the Word version.", 413);
  const kind = fileKind(fileName);
  if (!kind) throw new HttpError("Use a PDF, Word (.docx) or text file.", 415);
  if (!looksLike(kind, buffer)) throw new HttpError(`That file does not look like a real ${kind === "docx" ? "Word" : kind.toUpperCase()} file.`, 415);
  if (kind === "text" && buffer.length > MAX_TEXT_FILE) throw new HttpError("That text file is over 200 KB, far longer than a resume.", 413);
  if (kind === "docx") {
    const problem = docxProblem(buffer);
    if (problem) throw new HttpError(`That Word file has ${problem}. Save it again from Word, or upload the PDF.`, 415);
  }
  let text;
  try {
    text = await extractText(buffer, fileName, { maxPages: MAX_PDF_PAGES });
  } catch (err) {
    if (/pages; a resume should fit/.test(err.message)) throw new HttpError(err.message, 422);
    throw new HttpError("Shortlist could not read that file. Try the PDF or Word version.", 422);
  }
  const cleaned = cleanResume(String(text || "").slice(0, MAX_RAW_CHARS)).slice(0, MAX_RESUME_CHARS);
  if (cleaned.length < MIN_RESUME_CHARS) {
    throw new HttpError("There is almost no text in that file. A scanned PDF is a picture; upload the Word version or a PDF saved from it.", 422);
  }
  return cleaned;
}
