// GET /api/me: who is signed in, as Supabase confirms it, and whether a resume is on file. It reads the profile
// as that person, so the database's row level security applies: nobody can read someone else's profile here.
import { userFromRequest, asUser, NO_STORE } from "../src/cloud/supabase.js";

export async function GET(request) {
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  const res = await asUser(user, `/rest/v1/profiles?select=resume_file_name,resume_uploaded_at&user_id=eq.${encodeURIComponent(user.id)}`);
  if (!res.ok) return Response.json({ error: "Could not read your profile. Try again in a moment." }, { status: 502, headers: NO_STORE });
  const profile = (await res.json())[0] || null;
  return Response.json(
    {
      email: user.email,
      hasResume: Boolean(profile?.resume_file_name),
      resumeFileName: profile?.resume_file_name || null,
      resumeUploadedAt: profile?.resume_uploaded_at || null
    },
    { headers: NO_STORE }
  );
}
