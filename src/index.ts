import { Env, TelegramUpdate } from './types';
import { handleTelegramUpdate } from './telegram/handlers';
import { TelegramBot } from './telegram/bot';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Health check & status endpoint
    if (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/status') {
      return new Response(
        JSON.stringify({
          ok: true,
          project: env.PROJECT_NAME || 'TrendScope',
          version: '0.1.0',
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

    // 2. Comprehensive Debug & Diagnostics Endpoint
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

    // 3. Webhook Setup Helper
    if (url.pathname === '/setup-webhook') {
      const webhookUrl = `${url.origin}/webhook/telegram`;
      const secret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();
      const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
      const res = await bot.setWebhook(webhookUrl, secret);

      return new Response(JSON.stringify(res, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Telegram Webhook Endpoint
    if (url.pathname === '/webhook/telegram' && request.method === 'POST') {
      const receivedSecret = (request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
      const expectedSecret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();

      if (receivedSecret !== expectedSecret) {
        console.error(`[Webhook] 403 Forbidden! Expected: '${expectedSecret ? 'CONFIGURED' : 'EMPTY'}', Received: '${receivedSecret ? 'CONFIGURED' : 'EMPTY'}'`);
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
    console.log(`[Cron] Triggered at ${new Date().toISOString()} for cron ${event.cron}`);
  },
};
