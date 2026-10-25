// Starts the "Update data" workflow every hour. The workflow fetches results,
// recomputes, and deploys only when something changed.
const REPO = "SamBennettDev/rank";
const WORKFLOW = "update-data.yml";

async function dispatch(env) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rank-update-trigger",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  if (res.status !== 204)
    throw new Error(`dispatch failed: ${res.status} ${await res.text()}`);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
  // Visiting the worker URL does nothing; use `wrangler triggers` or the dashboard to test the cron.
  async fetch() {
    return new Response("rank-update-trigger", { status: 200 });
  },
};
