// knowbase refresh timer.
// GitHub's own cron skips most runs on this repo, so this Worker starts the
// "Refresh and deploy" workflow every 15 minutes through the GitHub API.
// Needs one secret: GH_TOKEN, a fine-grained token for Arryn21/knowbase with
// Actions: read and write.

const REPO = 'Arryn21/knowbase';
const WORKFLOW = 'update.yml';

async function dispatch(env) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GH_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'knowbase-refresh-worker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  // GitHub answers 204 No Content when the run is queued.
  if (res.status !== 204) {
    throw new Error(`GitHub dispatch failed: HTTP ${res.status} ${await res.text()}`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.GH_TOKEN) throw new Error('GH_TOKEN secret is not set');
    await dispatch(env);
    console.log(`Dispatched ${WORKFLOW} at ${new Date(event.scheduledTime).toISOString()}`);
  },

  // Deliberately does nothing on HTTP requests, so the public URL can't be used
  // to trigger the workflow.
  async fetch() {
    return new Response('knowbase refresh timer. Runs on a schedule only.\n', {
      headers: { 'content-type': 'text/plain' },
    });
  },
};
