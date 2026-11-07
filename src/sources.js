// Each company posts jobs through an applicant tracking system (ATS).
// Greenhouse, Lever and Ashby all publish open roles as public JSON, no login or key needed.
// I fetch each board and reshape every posting into one common format so the rest of the app
// never has to care which ATS a job came from.

const ENDPOINTS = {
  greenhouse: (board) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
  lever: (board) => `https://api.lever.co/v0/postings/${board}?mode=json`,
  ashby: (board) => `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`
};

// Job descriptions arrive as HTML (Greenhouse even double-encodes it), so I decode and strip tags.
export function htmlToText(html) {
  if (!html) return "";
  const decode = (s) => s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

  return decode(decode(html)
    .replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

export function normalizeGreenhouse(json, entry) {
  return (json.jobs || []).map((job) => ({
    id: `greenhouse:${entry.board}:${job.id}`,
    company: entry.company,
    title: job.title || "",
    location: job.location?.name || "",
    url: job.absolute_url || "",
    postedAt: job.first_published || job.updated_at || null,
    department: job.departments?.[0]?.name || "",
    text: htmlToText(job.content),
    source: "greenhouse"
  }));
}

export function normalizeLever(json, entry) {
  const list = Array.isArray(json) ? json : [];
  return list.map((job) => {
    const lists = (job.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n");
    return {
      id: `lever:${entry.board}:${job.id}`,
      company: entry.company,
      title: job.text || "",
      location: job.categories?.location || (job.categories?.allLocations || []).join(", "),
      url: job.hostedUrl || "",
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      department: job.categories?.department || job.categories?.team || "",
      text: [job.descriptionPlain || htmlToText(job.description), lists, job.additionalPlain || ""].join("\n").trim(),
      source: "lever"
    };
  });
}

// Ashby flags remote roles separately from the location text, so I add "Remote" only when it's missing.
function withRemote(location, isRemote) {
  if (!isRemote || /remote/i.test(location)) return location;
  return location ? `${location} (Remote)` : "Remote";
}

export function normalizeAshby(json, entry) {
  return (json.jobs || [])
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const extra = (job.secondaryLocations || []).map((s) => s.location).filter(Boolean);
      return {
        id: `ashby:${entry.board}:${job.id}`,
        company: entry.company,
        title: job.title || "",
        location: withRemote([job.location, ...extra].filter(Boolean).join(", "), job.isRemote),
        url: job.jobUrl || job.applyUrl || "",
        postedAt: job.publishedAt || null,
        department: job.department || job.team || "",
        text: job.descriptionPlain || htmlToText(job.descriptionHtml),
        source: "ashby"
      };
    });
}

const NORMALIZERS = { greenhouse: normalizeGreenhouse, lever: normalizeLever, ashby: normalizeAshby };

export function normalize(ats, json, entry) {
  const fn = NORMALIZERS[ats];
  if (!fn) throw new Error(`Unknown ATS "${ats}". Use greenhouse, lever or ashby.`);
  return fn(json, entry);
}

// One failed board should never sink the whole run, so I return the error instead of throwing.
export async function fetchBoard(entry, fetchImpl = fetch) {
  const build = ENDPOINTS[entry.ats];
  if (!build) return { entry, postings: [], error: `Unknown ATS "${entry.ats}"` };

  try {
    const res = await fetchImpl(build(entry.board), { headers: { "Accept": "application/json" } });
    if (res.status === 404) return { entry, postings: [], error: `Board "${entry.board}" not found on ${entry.ats} (check the slug)` };
    if (!res.ok) return { entry, postings: [], error: `${entry.ats} returned HTTP ${res.status}` };
    const json = await res.json();
    return { entry, postings: normalize(entry.ats, json, entry), error: null };
  } catch (err) {
    return { entry, postings: [], error: `Could not reach ${entry.ats}: ${err.message}` };
  }
}

export async function fetchAll(watchlist, fetchImpl = fetch) {
  return Promise.all(watchlist.map((entry) => fetchBoard(entry, fetchImpl)));
}
