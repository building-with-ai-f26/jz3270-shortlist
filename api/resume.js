// POST /api/resume: upload a resume (the file is the request body, its name in the X-File-Name header).
// It is read in memory, cleaned of contact details, encrypted for this account, and stored; the file is not kept.
// DELETE /api/resume: remove the resume and everything made from it (scores and past checks), to start over.
// Both act only for the signed-in person Supabase confirms; the user id never comes from the request.
import { asServer, ok } from "../src/cloud/supabase.js";
import { encryptResume, encryptionKey } from "../src/cloud/crypto.js";
import { readUpload, safeFileName, UPLOAD_GAP_SECONDS, MAX_UPLOAD } from "../src/cloud/resume.js";
import { handle, json, requireUser, HttpError } from "../src/cloud/http.js";

const q = encodeURIComponent;

export const POST = handle(async (request) => {
  const user = await requireUser(request);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD) throw new HttpError("That file is over 4 MB. Save a smaller PDF or the Word version.", 413);

  const last = await ok(await asServer(`/rest/v1/profiles?select=resume_uploaded_at&user_id=eq.${q(user.id)}`), "Reading your profile");
  const lastAt = (await last.json())[0]?.resume_uploaded_at;
  if (lastAt && Date.now() - Date.parse(lastAt) < UPLOAD_GAP_SECONDS * 1000) {
    throw new HttpError(`One upload every ${UPLOAD_GAP_SECONDS} seconds, please.`, 429);
  }

  const fileName = safeFileName(request.headers.get("x-file-name") || "");
  const text = await readUpload(Buffer.from(await request.arrayBuffer()), fileName);
  const uploadedAt = new Date().toISOString();
  await ok(await asServer("/rest/v1/profiles?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: user.id, resume_ciphertext: encryptResume(text, user.id, encryptionKey()), resume_file_name: fileName, resume_uploaded_at: uploadedAt }
  }), "Saving your resume");
  return json({ resumeFileName: fileName, resumeUploadedAt: uploadedAt, characters: text.length });
});

export const DELETE = handle(async (request) => {
  const user = await requireUser(request);
  const mine = `user_id=eq.${q(user.id)}`;
  await ok(await asServer(`/rest/v1/profiles?${mine}`, {
    method: "PATCH", prefer: "return=minimal", body: { resume_ciphertext: null, resume_file_name: null, resume_uploaded_at: null }
  }), "Removing your resume");
  await ok(await asServer(`/rest/v1/scores?${mine}`, { method: "DELETE", prefer: "return=minimal" }), "Removing your scores");
  await ok(await asServer(`/rest/v1/runs?${mine}`, { method: "DELETE", prefer: "return=minimal" }), "Removing your past checks");
  return json({ removed: true });
});
