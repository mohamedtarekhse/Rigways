// cron-worker/index.js
// Specialized worker to trigger Rigways ACM certificate expiry checks on Cloudflare Pages.

export default {
  async scheduled(event, env, ctx) {
    const apiBase = env.API_BASE_URL || 'https://rigways.pages.dev';
    const secret  = env.CRON_SECRET;

    if (!secret) {
      console.error('CRON_SECRET not set in environment variables.');
      return;
    }

    console.log(`Triggering check-expiry at ${apiBase}...`);

    try {
      const response = await fetch(`${apiBase}/api/cron/check-expiry`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret}`,
          'User-Agent': 'Rigways-Cron-Worker',
          'Cache-Control': 'no-store',
        },
      });

      const rawText = await response.text();
      let result = null;
      try { result = JSON.parse(rawText); } catch (_) { result = { raw: rawText.slice(0, 300) }; }
      if (!response.ok) {
        console.error('Cron trigger failed:', response.status, JSON.stringify(result));
        return;
      }
      console.log('Cron trigger result:', JSON.stringify(result));
    } catch (e) {
      console.error('Failed to trigger cron via API:', e);
    }
  },

  // Also allow manual trigger via fetch if needed for testing
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/run') {
      ctx.waitUntil(this.scheduled(null, env, ctx));
      return new Response('Cron trigger initiated.', { status: 202 });
    }
    return new Response('Rigways Cron Worker active.', { status: 200 });
  }
};
