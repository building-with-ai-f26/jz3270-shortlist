// `npm run refresh-postings` fills the development database's shared postings from this laptop, the same way
// the daily cron does on production (src/cloud/postings.js). It needs the dev project's SUPABASE_URL and
// SUPABASE_SECRET_KEY in .env and refuses production. Free: it only reads public job boards.
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";
import { refreshPostings, hostedStarter } from "../src/cloud/postings.js";
import { serverEnv } from "../src/cloud/supabase.js";

loadEnv(ROOT);
if ((process.env.SUPABASE_URL || "").includes("ohagjyhptkisbynowupl")) {
  console.error("This fills the development database only. Point SUPABASE_URL in .env at the dev project.");
  process.exit(1);
}
if (!serverEnv()) {
  console.error("Needs the dev project's SUPABASE_URL and SUPABASE_SECRET_KEY in .env.");
  process.exit(1);
}

const boards = hostedStarter();
let last = 0;
console.log(`Fetching ${boards.length} job boards into the development database...`);
const summary = await refreshPostings(boards, {
  onBoard: (done, total) => {
    if (done - last >= 25 || done === total) { last = done; console.log(`  ${done} of ${total} boards`); }
  }
});
console.log(`Done in ${summary.seconds} seconds: ${summary.found.toLocaleString("en-US")} open roles found, ` +
  `${summary.saved.toLocaleString("en-US")} posted in the last 30 days saved, ${summary.boardsFailed} boards failed.`);
for (const e of summary.errors) console.log(`  ${e.company}: ${e.error}`);
