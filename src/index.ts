import { Env, TelegramUpdate } from './types';
import { handleTelegramUpdate } from './telegram/handlers';
import { TelegramBot } from './telegram/bot';
import { runNewsPipeline } from './news/pipeline';
import { handleScheduledEvent, generateEpisodePackage } from './cron/scheduled';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Health check & status endpoint
    if (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/status') {
      return new Response(
        JSON.stringify({
          ok: true,
          project: env.PROJECT_NAME || 'TrendScope',
          version: '0.1.2',
          status: 'online',
          timezone: env.TIMEZONE,
          debug: env.DEBUG === 'true',
          timestamp: new Date().toISOString(),
        }, null, 2),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Trigger News Pipeline Endpoint (e.g. ?limit=5)
    if (url.pathname === '/api/trigger-test') {
      try {
        const limitParam = parseInt(url.searchParams.get('limit') || '5', 10);
        const stories = await runNewsPipeline(env, limitParam);
        return new Response(
          JSON.stringify({
            ok: true,
            message: `News pipeline executed successfully (${stories.length} stories)`,
            count: stories.length,
            stories,
          }, null, 2),
          {
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // 3. Trigger Episode Package Generation manually
    if (url.pathname === '/api/trigger-episode') {
      try {
        const result = await generateEpisodePackage(env);
        return new Response(
          JSON.stringify({ ok: true, result }, null, 2),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message }, null, 2),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 4. Comprehensive Debug & Diagnostics Endpoint
    if (url.pathname === '/api/debug') {
      const botToken = (env.TELEGRAM_BOT_TOKEN || '').trim();
      const bot = new TelegramBot(botToken);
      
      let webhookInfo: any = null;
      let botMe: any = null;
      let d1Status = 'untested';
      let storiesCount = 0;

      try {
        webhookInfo = await bot.getWebhookInfo();
      } catch (e: any) {
        webhookInfo = { error: e.message };
      }

      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        botMe = await res.json();
      } catch (e: any) {
        botMe = { error: e.message };
      }

      try {
        const dbRes = await env.DB.prepare('SELECT count(*) as count FROM stories').first<{ count: number }>();
        storiesCount = dbRes?.count || 0;
        d1Status = 'connected';
      } catch (e: any) {
        d1Status = `error: ${e.message}`;
      }

      const diagnostics = {
        timestamp: new Date().toISOString(),
        cloudflare: {
          project: env.PROJECT_NAME,
          timezone: env.TIMEZONE,
          debug: env.DEBUG,
        },
        credentials_present: {
          TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
          TELEGRAM_CHANNEL_ID: !!env.TELEGRAM_CHANNEL_ID,
          TELEGRAM_ADMIN_ID: !!env.TELEGRAM_ADMIN_ID,
          GEMINI_API_KEY: !!env.GEMINI_API_KEY,
          TELEGRAM_WEBHOOK_SECRET: !!env.TELEGRAM_WEBHOOK_SECRET,
        },
        d1_database: {
          status: d1Status,
          stories_count: storiesCount,
        },
        telegram: {
          bot_me: botMe,
          webhook_info: webhookInfo,
        },
      };

      return new Response(JSON.stringify(diagnostics, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Webhook Setup Helper
    if (url.pathname === '/setup-webhook') {
      const webhookUrl = `${url.origin}/webhook/telegram`;
      const secret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();
      const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
      const res = await bot.setWebhook(webhookUrl, secret);

      return new Response(JSON.stringify(res, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 6. Telegram Webhook Endpoint
    if (url.pathname === '/webhook/telegram' && request.method === 'POST') {
      const receivedSecret = (request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
      const expectedSecret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();

      if (receivedSecret !== expectedSecret) {
        console.error(`[Webhook] 403 Forbidden!`);
        return new Response('Invalid secret token', { status: 403 });
      }

      try {
        const update = (await request.json()) as TelegramUpdate;
        if (env.DEBUG === 'true') {
          console.log('[Webhook] Processing update:', JSON.stringify(update));
        }
        ctx.waitUntil(handleTelegramUpdate(update, env));
        return new Response('OK', { status: 200 });
      } catch (err: any) {
        console.error('[Webhook] Exception handling update:', err);
        return new Response(`Error: ${err.message}`, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduledEvent(event, env));
  },
};
