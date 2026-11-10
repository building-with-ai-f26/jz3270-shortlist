// Setup turns a few plain choices (kinds of roles, cities, schools) into the preferences file the
// filter reads, so nobody has to edit JSON by hand. The first-run screen sends these choices.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOOKING_FOR } from "./resume.js";

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config");
const SAMPLE_PROFILE = path.join(CONFIG, "profile.example.md");
const STARTER_FILE = path.join(CONFIG, "starter-watchlist.json");
const MAX_LOOKING_FOR = 2000;

// Every MBA search starts from these. They catch programs and roles built for people graduating in 2027,
// whatever the function.
const BASE_TITLES = ["MBA", "Associate", "Analyst", "New Grad", "Graduate", "University", "Early Career", "Campus", "2027"];
const BASE_SEARCHES = ["MBA", "2027", "new grad", "university", "rotational", "early career"];

// Each kind of role adds title words (a title needs at least one to pass the filter) and searches to run
// on Workday and SmartRecruiters boards. Each search is one more request per Workday company, so I keep them short.
export const ROLE_FAMILIES = {
  strategy: { label: "Strategy and operations", titles: ["Strategy", "Strategist", "Operations", "Business", "Chief of Staff", "Deployment"], searches: ["strategy", "operations"] },
  product: { label: "Product management", titles: ["Product Manager", "Product Management"], searches: ["product manager"] },
  finance: { label: "Finance and corporate development", titles: ["Finance", "Corporate Development", "Corp Dev", "FP&A", "Investment"], searches: ["finance", "corporate development"] },
  supplyChain: { label: "Supply chain", titles: ["Supply Chain", "Sourcing", "Procurement", "Logistics"], searches: ["supply chain"] },
  realEstate: { label: "Real estate", titles: ["Real Estate", "Acquisitions", "Development"], searches: ["real estate"] },
  marketing: { label: "Marketing", titles: ["Marketing", "Brand", "Growth"], searches: ["marketing"] },
  programs: { label: "Rotational and leadership programs", titles: ["Rotational", "Leadership", "Program"], searches: ["leadership program"] }
};

// Each city lists the place names job boards use for it. A posting passes if its location has any of them.
// State codes are left out on purpose ("WA", "MA"), except NY and NJ, which boards use on their own.
export const CITIES = {
  newYork: { label: "New York", locations: ["New York", "NY", "New Jersey", "NJ", "Brooklyn", "Jersey City", "Stamford"] },
  bayArea: { label: "San Francisco Bay Area", locations: ["San Francisco", "Bay Area", "Palo Alto", "Mountain View", "Menlo Park", "Redwood City", "Santa Clara", "San Jose", "Sunnyvale", "Oakland"] },
  losAngeles: { label: "Los Angeles", locations: ["Los Angeles", "Santa Monica", "Culver City", "El Segundo", "Hawthorne", "Long Beach", "Irvine", "Costa Mesa"] },
  boston: { label: "Boston", locations: ["Boston", "Cambridge, MA", "Somerville"] },
  chicago: { label: "Chicago", locations: ["Chicago"] },
  seattle: { label: "Seattle", locations: ["Seattle", "Bellevue", "Redmond"] },
  dc: { label: "Washington, DC", locations: ["Washington, DC", "Washington DC", "Arlington, VA", "McLean", "Reston"] },
  austin: { label: "Austin", locations: ["Austin"] },
  dallas: { label: "Dallas", locations: ["Dallas", "Fort Worth", "Plano", "Irving"] },
  atlanta: { label: "Atlanta", locations: ["Atlanta"] },
  denver: { label: "Denver", locations: ["Denver", "Boulder"] },
  miami: { label: "Miami", locations: ["Miami"] },
  remote: { label: "Remote", locations: ["Remote"] }
};

// Sectors of the starter company list. Each heading in config/companies.example.txt is one of these labels,
// and `npm run build-starter` turns the list into config/starter-watchlist.json, tagged by sector.
export const STARTER_SECTORS = {
  ai: "AI and software",
  hardtech: "Aerospace, defense and hard tech",
  climate: "Energy and climate",
  supplyChain: "Supply chain and logistics",
  fintech: "Fintech and financial services",
  consumer: "Consumer and marketplaces",
  health: "Health",
  realEstate: "Real estate and proptech"
};

// Settings setup does not ask about. A user's own values for these are kept.
const DEFAULTS = {
  tracks: ["Full-time", "Program"],
  titleExclude: [
    "Senior Staff", "Staff ", "Principal", "Director", "Head of", "Vice President", "VP,", "Lead ", "Senior Manager", "Engineer",
    "Software", "Recruiter", "Counsel", "Technician"
  ],
  maxAgeDays: 45,
  maxToScore: 40,
  workdayMaxPerSearch: 40
};

const unique = (list) => [...new Set(list)];

function pick(keys, table, what) {
  const list = Array.isArray(keys) ? keys : [];
  const unknown = list.filter((k) => !(k in table));
  if (unknown.length) throw new Error(`Unknown ${what}: ${unknown.join(", ")}`);
  return unique(list);
}

// answers = { roles: ["strategy", ...], cities: ["newYork", ...], schools: ["NYU Stern", ...] }
// No cities means no location filter. No roles means only the 2027 and MBA title words.
// Setup owns titleInclude, locations, workdaySearch and networkSchools; everything else in `existing` is kept.
export function buildPreferences(answers = {}, existing = {}) {
  const roles = pick(answers.roles, ROLE_FAMILIES, "role type");
  const cities = pick(answers.cities, CITIES, "city");
  const schools = unique((Array.isArray(answers.schools) ? answers.schools : [])
    .map((s) => String(s).trim().slice(0, 80))
    .filter(Boolean));

  return {
    ...DEFAULTS,
    ...existing,
    titleInclude: unique([...BASE_TITLES, ...roles.flatMap((r) => ROLE_FAMILIES[r].titles)]),
    locations: unique(cities.flatMap((c) => CITIES[c].locations)),
    workdaySearch: unique([...BASE_SEARCHES, ...roles.flatMap((r) => ROLE_FAMILIES[r].searches)]),
    networkSchools: schools,
    // The choices themselves, so the setup screen can show them again later.
    setup: { roles, cities }
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// Preferences written before setup existed have no `setup` record, so I work out which choices
// they already match: a role counts if one of its searches is there or all of its title words are,
// and a city counts if its main name is listed.
function inferChoices(prefs) {
  const searches = new Set((prefs.workdaySearch || []).map((s) => s.toLowerCase()));
  const titles = new Set((prefs.titleInclude || []).map((s) => s.toLowerCase()));
  const locations = new Set(prefs.locations || []);
  const matches = (r) => r.searches.some((s) => searches.has(s)) || r.titles.every((t) => titles.has(t.toLowerCase()));
  return {
    roles: Object.keys(ROLE_FAMILIES).filter((k) => matches(ROLE_FAMILIES[k])),
    cities: Object.keys(CITIES).filter((k) => locations.has(CITIES[k].locations[0]))
  };
}

export function lookingForText(profile = "") {
  const m = profile.match(LOOKING_FOR);
  return m ? profile.slice(m.index + m[0].length).trim() : "";
}

// Replaces the "What I'm looking for" section and leaves the resume above it alone.
export function withLookingFor(profile = "", text) {
  const m = profile.match(LOOKING_FOR);
  const top = (m ? profile.slice(0, m.index) : profile).trimEnd();
  return `${top || "# Profile"}\n\n## What I'm looking for\n\n${text.trim()}\n`;
}

// Everything above "What I'm looking for", which is the resume.
function resumePart(profile = "") {
  const m = profile.match(LOOKING_FOR);
  return (m ? profile.slice(0, m.index) : profile).trim();
}

// The starter companies, built from config/companies.example.txt by `npm run build-starter`.
export function readStarter() {
  return readJson(STARTER_FILE, { companies: [] }).companies;
}

const boardKey = (w) => `${w.ats}:${w.board}`.toLowerCase();

// Before setup saved any sectors, a sector counts as chosen if at least half its starter companies are on the watchlist.
function inferSectors(watchlist, starter) {
  const have = new Set(watchlist.map(boardKey));
  return Object.keys(STARTER_SECTORS).filter((k) => {
    const list = starter.filter((c) => c.sector === k);
    return list.length > 0 && list.filter((c) => have.has(boardKey(c))).length * 2 >= list.length;
  });
}

// Chosen sectors add their starter companies. Unchosen sectors remove only their starter companies,
// so a company the user added themselves is never taken off the watchlist.
export function applySectors(watchlist, sectors, starter) {
  const chosen = new Set(sectors);
  const unchosen = new Set(starter.filter((c) => !chosen.has(c.sector)).map(boardKey));
  const kept = watchlist.filter((w) => !unchosen.has(boardKey(w)));
  const have = new Set(kept.map(boardKey));
  const added = starter
    .filter((c) => chosen.has(c.sector) && !have.has(boardKey(c)))
    .map(({ company, ats, board, url }) => (url ? { company, ats, board, url } : { company, ats, board }));
  return [...kept, ...added];
}

// What the setup screen shows: the choices on offer and what this user picked.
// A fresh install still has the fictional sample profile. sampleResume tells the screen to ask for a
// real resume, and the sample's own "What I'm looking for" is left out of the form.
export function readSetup(dataDir, starter = readStarter()) {
  const prefs = readJson(path.join(dataDir, "preferences.json"), {});
  const watchlist = readJson(path.join(dataDir, "watchlist.json"), []);
  const profile = fs.existsSync(path.join(dataDir, "profile.md")) ? fs.readFileSync(path.join(dataDir, "profile.md"), "utf8") : "";
  const sample = fs.readFileSync(SAMPLE_PROFILE, "utf8");
  const sampleResume = !resumePart(profile) || resumePart(profile) === resumePart(sample);
  const lookingFor = lookingForText(profile);
  // On a fresh install the preferences and watchlist are the starter examples, which are not this user's choice.
  const fresh = !prefs.setup && sampleResume;
  const chosen = prefs.setup || (fresh ? { roles: [], cities: [] } : inferChoices(prefs));
  return {
    roles: chosen.roles,
    cities: chosen.cities,
    sectors: chosen.sectors || (fresh ? [] : inferSectors(watchlist, starter)),
    schools: fresh ? [] : (prefs.networkSchools || []),
    lookingFor: lookingFor === lookingForText(sample) ? "" : lookingFor,
    sampleResume,
    watchlistCount: watchlist.length,
    options: {
      roles: Object.entries(ROLE_FAMILIES).map(([key, r]) => ({ key, label: r.label })),
      cities: Object.entries(CITIES).map(([key, c]) => ({ key, label: c.label })),
      sectors: Object.entries(STARTER_SECTORS).map(([key, label]) => ({ key, label, count: starter.filter((c) => c.sector === key).length }))
    }
  };
}

// Saves the setup form. The profile is only rewritten if "What I'm looking for" actually changed,
// because any change to the profile means every saved score is redone (and paid for) on the next check.
// The watchlist only changes when the form sends sectors.
export function saveSetup(input = {}, dataDir, starter = readStarter()) {
  const prefsPath = path.join(dataDir, "preferences.json");
  const existing = readJson(prefsPath, {});
  const prefs = buildPreferences(input, existing);
  const sectors = input.sectors === undefined ? null : pick(input.sectors, STARTER_SECTORS, "sector");
  const savedSectors = sectors || existing.setup?.sectors;
  if (savedSectors) prefs.setup.sectors = savedSectors;

  const lookingFor = typeof input.lookingFor === "string" ? input.lookingFor.trim() : "";
  if (lookingFor.length > MAX_LOOKING_FOR) throw new Error(`Keep "What I'm looking for" under ${MAX_LOOKING_FOR} characters.`);

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2) + "\n");

  if (sectors) {
    const watchlistPath = path.join(dataDir, "watchlist.json");
    const watchlist = applySectors(readJson(watchlistPath, []), sectors, starter);
    fs.writeFileSync(watchlistPath, JSON.stringify(watchlist, null, 2) + "\n");
  }

  const profilePath = path.join(dataDir, "profile.md");
  const profile = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf8") : "";
  if (lookingFor && lookingFor !== lookingForText(profile)) fs.writeFileSync(profilePath, withLookingFor(profile, lookingFor));

  return readSetup(dataDir, starter);
}
