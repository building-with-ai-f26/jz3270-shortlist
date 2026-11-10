// Setup turns a few plain choices (kinds of roles, cities, schools) into the preferences file the
// filter reads, so nobody has to edit JSON by hand. The first-run screen sends these choices.

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
