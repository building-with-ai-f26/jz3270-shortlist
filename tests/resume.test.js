import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileKind, extractText, cleanResume, mergeProfile, saveResume, readResumeMeta } from "../src/resume.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-resume-"));

test("fileKind accepts PDF, Word and text, and nothing else", () => {
  assert.equal(fileKind("Resume.PDF"), "pdf");
  assert.equal(fileKind("cv.docx"), "docx");
  assert.equal(fileKind("notes.md"), "text");
  assert.equal(fileKind("old.doc"), null);
  assert.equal(fileKind("photo.png"), null);
});

const nodeMajor = Number(process.versions.node.split(".")[0]);
const pdfOk = nodeMajor >= 22;

test("reads text out of a PDF and a Word file", async () => {
  for (const name of pdfOk ? ["resume-sample.pdf", "resume-sample.docx"] : ["resume-sample.docx"]) {
    const text = await extractText(fs.readFileSync(path.join(FIX, name)), name);
    assert.match(text, /Harbor Freight Partners/, name);
    assert.match(text, /Argus/, name);
  }
});

test("cleanResume removes email, phone and links but keeps the content", () => {
  const out = cleanResume("Sam Rivera\nsam.rivera@example.com | (555) 010-4477 | linkedin.com/in/sam | https://sam.dev | Brooklyn, NY\nSQL, Python");
  assert.doesNotMatch(out, /@|555|linkedin|https/);
  assert.match(out, /Brooklyn, NY/);
  assert.match(out, /SQL, Python/);
});

test("mergeProfile swaps the resume and keeps what I'm looking for", () => {
  const old = "# Profile\n\n## Resume\n\nOld stuff\n\n## What I'm looking for\n\nNYC real estate roles.\n";
  const merged = mergeProfile(old, "New resume text");
  assert.match(merged, /New resume text/);
  assert.doesNotMatch(merged, /Old stuff/);
  assert.match(merged, /NYC real estate roles/);
  assert.match(mergeProfile("", "x"), /## What I'm looking for/);
});

test("on Node older than 22, a PDF gets a clear message instead of a crash", { skip: pdfOk }, async () => {
  await assert.rejects(extractText(fs.readFileSync(path.join(FIX, "resume-sample.pdf")), "r.pdf"), /Node 22 or newer/);
});

test("saveResume writes the profile, a backup and the upload record", async () => {
  const dir = tmp();
  const file = pdfOk ? "resume-sample.pdf" : "resume-sample.docx";
  fs.writeFileSync(path.join(dir, "profile.md"), "# Profile\n\nOld\n\n## What I'm looking for\n\nOperations roles in NYC.\n");
  const meta = await saveResume(fs.readFileSync(path.join(FIX, file)), file, dir);

  const profile = fs.readFileSync(path.join(dir, "profile.md"), "utf8");
  assert.match(profile, /Greenline Properties/);
  assert.match(profile, /Operations roles in NYC/);
  assert.doesNotMatch(profile, /example\.com|010-4477|linkedin/);
  assert.match(fs.readFileSync(path.join(dir, "profile.previous.md"), "utf8"), /Old/);
  assert.equal(meta.fileName, file);
  assert.deepEqual(readResumeMeta(dir), meta);
});

test("saveResume creates the data folder on a fresh install", async () => {
  const dir = path.join(tmp(), "data");
  await saveResume(fs.readFileSync(path.join(FIX, "resume-sample.docx")), "resume-sample.docx", dir);
  assert.ok(fs.existsSync(path.join(dir, "profile.md")));
});

test("saveResume rejects empty, unsupported and too-short files", async () => {
  const dir = tmp();
  await assert.rejects(saveResume(Buffer.alloc(0), "a.pdf", dir), /empty/);
  await assert.rejects(saveResume(Buffer.from("hello"), "a.png", dir), /PDF, Word/);
  await assert.rejects(saveResume(Buffer.from("too short"), "a.txt", dir), /enough text/);
  assert.equal(readResumeMeta(dir), null);
});
