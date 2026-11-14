import { Env, TelegramUpdate } from './types';
import { handleTelegramUpdate } from './telegram/handlers';
import { TelegramBot } from './telegram/bot';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Health check endpoint
    if (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/status') {
      return new Response(
        JSON.stringify({
          ok: true,
          project: env.PROJECT_NAME || 'TrendScope',
          version: '0.1.0',
          status: 'online',
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Webhook Setup Helper (One-click or CLI registration)
    if (url.pathname === '/setup-webhook') {
      const secret = url.searchParams.get('secret');
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      const webhookUrl = `${url.origin}/webhook/telegram`;
      const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
      const res = await bot.setWebhook(webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);

      return new Response(JSON.stringify(res, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Telegram Webhook Endpoint
    if (url.pathname === '/webhook/telegram' && request.method === 'POST') {
      const receivedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (receivedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Invalid secret token', { status: 403 });
      }

      try {
        const update = (await request.json()) as TelegramUpdate;
        ctx.waitUntil(handleTelegramUpdate(update, env));
        return new Response('OK', { status: 200 });
      } catch (err: any) {
        return new Response(`Error: ${err.message}`, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled crons (Milestone 3)
    console.log(`Cron triggered at ${new Date().toISOString()} for cron ${event.cron}`);
  },
};
