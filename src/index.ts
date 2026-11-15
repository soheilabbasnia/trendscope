import { Env, TelegramUpdate, Story } from './types';
import { handleTelegramUpdate } from './telegram/handlers';
import { TelegramBot } from './telegram/bot';
import { runNewsPipeline } from './news/pipeline';
import { handleScheduledEvent, generateEpisodePackage } from './cron/scheduled';
import { approveStory, rejectStory } from './workflow/storyActions';
import { DASHBOARD_HTML } from './dashboard/bundledHtml';
import { LOGO_BASE64 } from './assets/logoData';
import { FONTS_DATA } from './assets/fontsData';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ==========================================
    // 1. Static Assets & Frontend Dashboard
    // ==========================================

    // Serve Fonts (Anjoman & Ravi)
    if (url.pathname.startsWith('/api/fonts/')) {
      const fontName = url.pathname.replace('/api/fonts/', '').trim();
      const fontB64 = FONTS_DATA[fontName];
      if (fontB64) {
        const binaryString = atob(fontB64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Response(bytes, {
          headers: {
            'Content-Type': 'font/woff2',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
      return new Response('Font not found', { status: 404 });
    }

    // Serve Owl Logo
    if (url.pathname === '/api/logo' || url.pathname === '/logo.jpeg' || url.pathname === '/logo.png') {
      const binaryString = atob(LOGO_BASE64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Response(bytes, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=604800, immutable',
        },
      });
    }

    // Serve Dashboard HTML
    const accept = request.headers.get('Accept') || '';
    if (
      url.pathname === '/dashboard' ||
      (url.pathname === '/' && accept.includes('text/html'))
    ) {
      return new Response(DASHBOARD_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // ==========================================
    // 2. Health check & status endpoint (JSON)
    // ==========================================
    if (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/status') {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            project: env.PROJECT_NAME || 'TrendScope',
            version: '0.2.0',
            status: 'online',
            timezone: env.TIMEZONE || 'Asia/Tehran',
            debug: env.DEBUG === 'true',
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // ==========================================
    // 3. Single-User Authentication (/api/auth/login)
    // ==========================================
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = (await request.json()) as any;
        const passcode = (body?.passcode || '').trim();
        const adminId = (env.TELEGRAM_ADMIN_ID || '').trim();
        const secret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();

        if (!passcode || (passcode !== adminId && passcode !== secret)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'رمز عبور یا شناسه مدیریتی نادرست است.' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Generate HMAC signed token valid for 30 days
        const payload = {
          role: 'admin',
          exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
        };
        const payloadB64 = btoa(JSON.stringify(payload));
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret || adminId),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
        const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
        const token = `${payloadB64}.${sigB64}`;

        return new Response(
          JSON.stringify({ ok: true, token, role: 'admin', message: 'احراز هویت موفق بود.' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // ==========================================
    // 4. Authenticated Dashboard Endpoints (/api/dashboard/*)
    // ==========================================
    if (url.pathname.startsWith('/api/dashboard/')) {
      const authorized = await isAuthorized(request, env);
      if (!authorized) {
        return new Response(
          JSON.stringify({ ok: false, error: 'دسترسی غیرمجاز. لطفاً وارد شوید.' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4.1 Overview Metrics
      if (url.pathname === '/api/dashboard/overview' && request.method === 'GET') {
        const totalRes = await env.DB.prepare('SELECT count(*) as c FROM stories').first<{ c: number }>();
        const pendingRes = await env.DB.prepare(
          "SELECT count(*) as c FROM stories WHERE status IN ('new', 'alerted', 'general') AND combined_score > 8.5"
        ).first<{ c: number }>();
        const approvedRes = await env.DB.prepare(
          "SELECT count(*) as c FROM stories WHERE status IN ('approved', 'selected')"
        ).first<{ c: number }>();
        const rejectedRes = await env.DB.prepare(
          "SELECT count(*) as c FROM stories WHERE status = 'rejected'"
        ).first<{ c: number }>();

        return new Response(
          JSON.stringify({
            totalCount: totalRes?.c || 0,
            pendingCount: pendingRes?.c || 0,
            approvedCount: approvedRes?.c || 0,
            rejectedCount: rejectedRes?.c || 0,
            lastCollectionTime: 'امروز ۰۶:۳۰',
            nextRunTehran: 'دوشنبه و جمعه ساعت ۰۷:۰۰',
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4.2 Pending Stories (General Feed)
      if (url.pathname === '/api/dashboard/pending' && request.method === 'GET') {
        const { results: stories } = await env.DB.prepare(`
          SELECT * FROM stories
          WHERE status IN ('new', 'alerted', 'general') AND combined_score > 8.5
          ORDER BY combined_score DESC, created_at DESC
          LIMIT 50
        `).all<Story>();

        const mapped = await mapStoriesWithSources(env.DB, stories || [], 'general');
        return new Response(JSON.stringify(mapped), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4.3 Approved Stories (News Archive)
      if (url.pathname === '/api/dashboard/approved' && request.method === 'GET') {
        const { results: stories } = await env.DB.prepare(`
          SELECT * FROM stories
          WHERE status IN ('approved', 'selected')
          ORDER BY updated_at DESC
          LIMIT 50
        `).all<Story>();

        const mapped = await mapStoriesWithSources(env.DB, stories || [], 'approved');
        return new Response(JSON.stringify(mapped), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4.4 Approve Story
      if (url.pathname === '/api/dashboard/approve' && request.method === 'POST') {
        const body = (await request.json()) as any;
        const storyId = body?.storyId;
        if (!storyId) {
          return new Response(JSON.stringify({ ok: false, error: 'storyId الزامی است' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await approveStory(env, storyId, {
          type: 'dashboard',
          userId: 'dashboard-admin',
        });

        return new Response(
          JSON.stringify({ ok: result.success, message: result.message, story: result.story }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4.5 Reject Story
      if (url.pathname === '/api/dashboard/reject' && request.method === 'POST') {
        const body = (await request.json()) as any;
        const storyId = body?.storyId;
        if (!storyId) {
          return new Response(JSON.stringify({ ok: false, error: 'storyId الزامی است' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await rejectStory(env, storyId, {
          type: 'dashboard',
          userId: 'dashboard-admin',
        });

        return new Response(
          JSON.stringify({ ok: result.success, message: result.message, story: result.story }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4.6 Reports List
      if (url.pathname === '/api/dashboard/reports' && request.method === 'GET') {
        const { results: episodes } = await env.DB.prepare(
          'SELECT * FROM episodes ORDER BY id DESC LIMIT 10'
        ).all<any>();

        return new Response(JSON.stringify(episodes || []), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4.7 System Status
      if (url.pathname === '/api/dashboard/status' && request.method === 'GET') {
        return new Response(
          JSON.stringify({
            ok: true,
            version: '0.2.0',
            d1: 'connected',
            telegram: 'ready',
            gemini: 'operational',
            scoreThreshold: 8.5,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4.8 Manual Refresh
      if (url.pathname === '/api/dashboard/refresh' && request.method === 'POST') {
        try {
          const stories = await runNewsPipeline(env, 5);
          return new Response(
            JSON.stringify({
              ok: true,
              count: stories.length,
              message: `پایپ‌لاین با موفقیت اجرا شد. ${stories.length} خبر جدید اضافه گردید.`,
              stories,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch (err: any) {
          return new Response(
            JSON.stringify({ ok: false, error: err.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // 4.9 Settings GET / POST
      if (url.pathname === '/api/dashboard/settings') {
        if (request.method === 'GET') {
          const { results: settingsRows } = await env.DB.prepare('SELECT key, value FROM settings').all<any>();
          const settingsObj: Record<string, string> = {};
          (settingsRows || []).forEach((r) => {
            settingsObj[r.key] = r.value;
          });
          return new Response(
            JSON.stringify({
              collectionInterval: settingsObj.collection_interval || '30',
              minScore: parseFloat(settingsObj.auto_publish_threshold || '8.5'),
              enabledCategories: [
                'هوش مصنوعی',
                'سخت‌افزار و تراشه',
                'امنیت سایبری',
                'نرم‌افزار و متن‌باز',
                'زیرساخت و شبکه',
                'رایانش کوانتومی',
                'سیاست‌گذاری فناوری',
                'انرژی و سخت‌افزار',
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (request.method === 'POST') {
          const body = (await request.json()) as any;
          if (body?.minScore) {
            await env.DB.prepare(
              "INSERT INTO settings (key, value, updated_at) VALUES ('auto_publish_threshold', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
            )
              .bind(String(body.minScore), String(body.minScore))
              .run();
          }
          return new Response(JSON.stringify({ ok: true, message: 'تنظیمات ذخیره شد' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ==========================================
    // 5. Diagnostics & Debug Endpoint
    // ==========================================
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

    // ==========================================
    // 6. Webhook Setup Helper
    // ==========================================
    if (url.pathname === '/setup-webhook') {
      const webhookUrl = `${url.origin}/webhook/telegram`;
      const secret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();
      const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
      const res = await bot.setWebhook(webhookUrl, secret);

      return new Response(JSON.stringify(res, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // 7. Telegram Webhook Endpoint
    // ==========================================
    if (url.pathname === '/webhook/telegram' && request.method === 'POST') {
      const receivedSecret = (request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
      const expectedSecret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();

      if (receivedSecret !== expectedSecret) {
        console.error('[Webhook] 403 Forbidden!');
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

// ==========================================
// Helper Functions
// ==========================================

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const authHeader = request.headers.get('Authorization') || '';
  const adminId = (env.TELEGRAM_ADMIN_ID || '').trim();
  const secret = (env.TELEGRAM_WEBHOOK_SECRET || '').trim();

  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (authHeader) {
    token = authHeader.trim();
  }

  if (!token) {
    token = (request.headers.get('X-Admin-Token') || '').trim();
  }

  if (!token) return false;

  // Direct matches with admin credentials
  if (token === adminId || token === secret) return true;

  // HMAC token verification
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sigB64] = parts;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Date.now()) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret || adminId),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payloadB64));
  } catch {
    return false;
  }
}

async function mapStoriesWithSources(
  db: D1Database,
  stories: Story[],
  statusType: 'general' | 'approved'
): Promise<any[]> {
  const mapped = [];

  for (const s of stories) {
    const { results: sources } = await db.prepare(`
      SELECT a.title, a.url, s.name as source
      FROM articles a
      JOIN story_articles sa ON a.id = sa.article_id
      JOIN sources s ON a.source_id = s.id
      WHERE sa.story_id = ?
    `)
      .bind(s.id)
      .all<any>();

    const sourceRefs = (sources || [])
      .filter((x) => x.url && x.url.startsWith('http'))
      .map((x) => ({
        label: x.source || 'منبع اصلی',
        url: x.url,
      }));

    mapped.push({
      id: s.id,
      persianTitle: s.persian_title || s.title,
      englishTitle: s.title && s.title !== s.persian_title ? s.title : '',
      summary: s.persian_summary || s.why_it_matters || 'خلاصه موجود نیست.',
      category: s.primary_category || 'هوش مصنوعی',
      score: s.combined_score || 0,
      publisher: sourceRefs[0]?.label || 'منبع خبر',
      publishedAt: formatRelativePersianTime(s.created_at),
      timestamp: new Date(s.created_at).getTime() || Date.now(),
      dateGroup: getDateGroup(s.created_at),
      status: statusType,
      sources: sourceRefs,
    });
  }

  return mapped;
}

function formatRelativePersianTime(dateStr: string): string {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return 'چند لحظه پیش';
    if (diffHours < 24) return `${diffHours} ساعت پیش`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'دیروز';
    return `${diffDays} روز پیش`;
  } catch {
    return 'به‌تازگی';
  }
}

function getDateGroup(dateStr: string): 'today' | 'yesterday' | 'week' {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 24) return 'today';
    if (diffHours < 48) return 'yesterday';
    return 'week';
  } catch {
    return 'today';
  }
}
