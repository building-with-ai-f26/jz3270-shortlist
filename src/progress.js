// Progress for the page while a check or an explore sweep runs. Each stage has a weight, its usual share of
// the time, and fills as its count goes up, so the page can show one percent and which stage is running.
// The percent never goes backwards and stays at 99 until the run has finished.
export function progressTracker(stages, onProgress) {
  const sum = stages.reduce((a, s) => a + s.weight, 0);
  const outline = stages.map(({ key, label }) => ({ key, label }));
  let percent = 0;
  // So the page can show how long the run has taken.
  const startedAt = new Date().toISOString();
  function update(key, done = 0, total = 0, extra = {}) {
    if (!onProgress) return;
    const i = stages.findIndex((s) => s.key === key);
    if (i === -1) return;
    const before = stages.slice(0, i).reduce((a, s) => a + s.weight, 0);
    const share = total ? Math.min(1, done / total) : 0;
    percent = Math.max(percent, Math.min(99, Math.floor(((before + stages[i].weight * share) / sum) * 100)));
    onProgress({ stage: key, doing: stages[i].doing, done, total, percent, stages: outline, startedAt, ...extra });
  }
  function finish(extra = {}) {
    if (onProgress) onProgress({ stage: "done", doing: "Done", done: 0, total: 0, percent: 100, stages: outline, startedAt, ...extra });
  }
  return { update, finish };
}
