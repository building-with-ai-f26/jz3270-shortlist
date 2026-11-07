// Runs an async job over a list with at most `size` jobs in flight at once.
// I use this for job boards and model calls so a long list stays fast without flooding anyone's servers.
export async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}
