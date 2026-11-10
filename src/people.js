// "Who could I reach out to?" For each role I build 4-5 LinkedIn search links instead of pulling
// names myself. LinkedIn's terms forbid automated collection, and its own search, opened while the
// user is logged in, shows real and current people. Nothing about anyone is fetched or stored here.

const SEARCH = "https://www.linkedin.com/search/results/people/";

// Words I add to my own watchlist names ("Adobe University", "Blackstone Campus") that are not
// part of the company's real name on LinkedIn.
export function peopleCompanyName(company = "") {
  return company.replace(/\s+(university|campus|college|early career)$/i, "").trim();
}

const TEAMS = [
  [/supply chain|sourcing|procurement|logistics|fulfillment/i, "supply chain"],
  [/real estate|acquisitions|site selection|development manager|portfolio/i, "real estate"],
  [/deployment|forward deployed/i, "deployment strategist"],
  [/strateg/i, "strategy"],
  [/operations|\bops\b/i, "operations"],
  [/finance|fp&a|treasury/i, "finance"],
  [/product/i, "product"],
  [/rotation|leadership (development )?program/i, "rotational program"],
  [/business development|partnerships/i, "partnerships"]
];

// "Columbia University" reads long on a link; the search itself still uses the full name.
export function schoolLabel(school = "") {
  return school.replace(/^university of\s+/i, "").replace(/\s+university$/i, "").trim() || school;
}

export function teamFor(title = "") {
  const hit = TEAMS.find(([re]) => re.test(title));
  return hit ? hit[1] : null;
}

export function searchUrl(keywords, network) {
  const q = new URLSearchParams({ keywords, origin: network ? "FACETED_SEARCH" : "GLOBAL_SEARCH_HEADER" });
  if (network) q.set("network", JSON.stringify(network));
  return `${SEARCH}?${q.toString()}`;
}

export function peopleLinks(posting, prefs = {}) {
  const company = peopleCompanyName(posting.company);
  if (!company) return [];
  const schools = (prefs.networkSchools || ["NYU Stern"]).slice(0, 2);
  const isGrad = posting.cohort === "2027 grad";
  const team = teamFor(posting.title);

  const links = schools.map((school) => ({ label: `${schoolLabel(school)} alumni`, url: searchUrl(`${school} ${company}`) }));
  links.push({ label: "2nd-degree connections", url: searchUrl(company, ["S"]) });
  links.push({ label: isGrad ? "University recruiters" : "Recruiters", url: searchUrl(`${company} ${isGrad ? "university recruiting" : "recruiter"}`) });
  if (team) links.push({ label: `${team[0].toUpperCase()}${team.slice(1)} team`, url: searchUrl(`${company} ${team}`) });
  // MBAs who joined the company are the next-best shared background, and keep every role at 4 or more links.
  links.push({ label: "MBAs there", url: searchUrl(`${company} MBA`) });
  return links.slice(0, 5);
}
