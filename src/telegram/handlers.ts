import { Env, TelegramUpdate, Story } from '../types';
import { TelegramBot } from './bot';
import { runNewsPipeline } from '../news/pipeline';
import { updateTastePreference } from '../news/ranker';
import {
  formatStoryGeneralMessage,
  formatStoryNewsMessage,
  buildGeneralKeyboard,
  buildNewsKeyboard,
  SourceArticleRef,
} from './formatters';
import { getTopicThreadId, setTopicThreadId } from './topics';

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
  const adminId = (env.TELEGRAM_ADMIN_ID || '').trim();

  try {
    // ==========================================
    // 1. Handle Callback Queries (Inline Buttons)
    // ==========================================
    if (update.callback_query) {
      const cb = update.callback_query;
      const userId = String(cb.from.id);
      const data = cb.data || '';
      console.log(`[Telegram:Callback] From: ${userId}, Data: ${data}`);

      // Handle general public views
      if (data === 'view:selected') {
        const { results } = await env.DB.prepare(
          "SELECT * FROM stories WHERE status = 'selected' ORDER BY updated_at DESC"
        ).all<Story>();
        let summary = `🎬 <b>خبرهای تأییدشده برای ضبط (${results?.length || 0} مورد):</b>\n\n`;
        (results || []).forEach((s, idx) => {
          summary += `${idx + 1}. <b>${s.persian_title || s.title}</b>\n`;
        });
        await bot.sendMessage({
          chat_id: cb.message?.chat.id || cb.from.id,
          message_thread_id: cb.message?.message_thread_id,
          text: summary,
        });
        await bot.answerCallbackQuery({ callback_query_id: cb.id });
        return;
      }

      // Security check: Only configured admin can perform management actions
      if (userId !== adminId) {
        await bot.answerCallbackQuery({
          callback_query_id: cb.id,
          text: '⚠️ شما مجاز به انجام عملیات مدیریتی نیستید.',
          show_alert: true,
        });
        return;
      }

      const [action, storyId] = data.split(':');
      if (!storyId) {
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: 'دستور نامعتبر است.' });
        return;
      }

      const currentStory = await env.DB.prepare('SELECT * FROM stories WHERE id = ?')
        .bind(storyId)
        .first<Story>();

      if (!currentStory) {
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: 'خبر یافت نشد.' });
        return;
      }

      // ------------------------------------------
      // ACTION: SAVE (From General Topic)
      // ------------------------------------------
      if (action === 'save') {
        // Prevent duplicate saves or duplicate posts in News
        const alreadyInNews = await env.DB.prepare(
          "SELECT id FROM telegram_deliveries WHERE story_id = ? AND delivery_type = 'news'"
        )
          .bind(storyId)
          .first<{ id: number }>();

        if (alreadyInNews || currentStory.status === 'saved' || currentStory.status === 'selected') {
          await bot.answerCallbackQuery({
            callback_query_id: cb.id,
            text: 'این خبر قبلاً ذخیره و به تاپیک News منتقل شده است.',
            show_alert: true,
          });
          return;
        }

        // Fetch source articles for this story
        const { results: sources } = await env.DB.prepare(`
          SELECT a.title, a.url, s.name as source
          FROM articles a
          JOIN story_articles sa ON a.id = sa.article_id
          JOIN sources s ON a.source_id = s.id
          WHERE sa.story_id = ?
        `)
          .bind(storyId)
          .all<SourceArticleRef>();

        // Get target News topic thread ID
        const newsThreadId = await getTopicThreadId(env, 'news');
        const targetChatId = (env.TELEGRAM_CHANNEL_ID || '').trim();

        const newsText = formatStoryNewsMessage(currentStory, sources || []);
        const newsKeyboard = buildNewsKeyboard(currentStory.id);

        // Send to News topic
        const sendRes = await bot.sendMessage({
          chat_id: targetChatId,
          message_thread_id: newsThreadId,
          text: newsText,
          reply_markup: newsKeyboard,
        });

        if (!sendRes?.ok) {
          console.error('[Save to News Failed]', sendRes);
          await bot.answerCallbackQuery({
            callback_query_id: cb.id,
            text: 'خطا در ارسال به تاپیک News. لطفا با دستور /settopic news شناسه تاپیک را تنظیم کنید.',
            show_alert: true,
          });
          return;
        }

        // 1. Update story status in D1
        await env.DB.prepare("UPDATE stories SET status = 'saved', updated_at = datetime('now') WHERE id = ?")
          .bind(storyId)
          .run();

        // 2. Store new Telegram message ID and topic ID in telegram_deliveries
        await env.DB.prepare(`
          INSERT INTO telegram_deliveries (story_id, chat_id, message_thread_id, message_id, delivery_type)
          VALUES (?, ?, ?, ?, 'news')
        `)
          .bind(storyId, targetChatId, newsThreadId || null, sendRes.result.message_id)
          .run();

        // 3. Record positive feedback for Taste Engine
        await recordFeedback(env.DB, storyId, userId, 'save');
        const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
        await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'save');

        // 4. Update the original General message to reflect its saved status without adding extra action buttons
        await updateMessageStatusBanner(bot, cb.message, '⭐ این خبر ذخیره شد و به تاپیک News منتقل گردید', true);
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '⭐ خبر ذخیره شد و به تاپیک News ارسال گردید.' });
        return;
      }

      // ------------------------------------------
      // ACTION: REJECT (From General Topic)
      // ------------------------------------------
      if (action === 'reject') {
        await env.DB.prepare("UPDATE stories SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
          .bind(storyId)
          .run();

        await recordFeedback(env.DB, storyId, userId, 'reject');
        const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
        await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'reject');

        await updateMessageStatusBanner(bot, cb.message, '❌ این خبر رد شد', true);
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '❌ خبر رد شد.' });
        return;
      }

      // ------------------------------------------
      // ACTION: APPROVE (From News Topic)
      // ------------------------------------------
      if (action === 'approve') {
        if (currentStory.status === 'selected') {
          await bot.answerCallbackQuery({
            callback_query_id: cb.id,
            text: 'این خبر قبلاً برای ضبط تأیید شده است.',
          });
          return;
        }

        // 1. Mark story as approved (selected)
        await env.DB.prepare("UPDATE stories SET status = 'selected', updated_at = datetime('now') WHERE id = ?")
          .bind(storyId)
          .run();

        // 2. Add to current recording episode's selected stories
        let episode = await env.DB.prepare("SELECT * FROM episodes WHERE status = 'draft' ORDER BY id DESC LIMIT 1").first<any>();
        if (!episode) {
          const now = new Date();
          const epCode = `EP-${now.toISOString().split('T')[0]}-DRAFT`;
          const ins = await env.DB.prepare(
            "INSERT INTO episodes (episode_code, title, window_start, window_end, status) VALUES (?, 'پکیج در حال تکمیل', datetime('now', '-3 days'), datetime('now'), 'draft')"
          )
            .bind(epCode)
            .run();
          episode = { id: ins.meta.last_row_id };
        }

        await env.DB.prepare(`
          INSERT INTO episode_stories (episode_id, story_id, rank_order, is_selected)
          VALUES (?, ?, 1, 1)
          ON CONFLICT(episode_id, story_id) DO UPDATE SET is_selected = 1
        `)
          .bind(episode.id, storyId)
          .run();

        // 3. Record positive feedback for Taste Engine
        await recordFeedback(env.DB, storyId, userId, 'select');
        const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
        await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'select');

        // 4. Update News message to show approval
        await updateMessageStatusBanner(bot, cb.message, '✅ تأیید شد برای ضبط ویدیوی یوتیوب', true);
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '✅ خبر برای ضبط ویدیو تأیید و انتخاب شد.' });
        return;
      }

      // ------------------------------------------
      // ACTION: REJECT_NEWS (From News Topic)
      // ------------------------------------------
      if (action === 'reject_news') {
        // 1. Remove from recording selection
        await env.DB.prepare('UPDATE episode_stories SET is_selected = 0 WHERE story_id = ?')
          .bind(storyId)
          .run();

        // 2. Mark story as rejected
        await env.DB.prepare("UPDATE stories SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
          .bind(storyId)
          .run();

        // 3. Record negative preference feedback
        await recordFeedback(env.DB, storyId, userId, 'reject');
        const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
        await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'reject');

        // 4. Update News message accordingly
        await updateMessageStatusBanner(bot, cb.message, '❌ خبر از اولویت ضبط رد شد', true);
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '❌ خبر از اولویت ضبط رد شد.' });
        return;
      }

      return;
    }

    // ==========================================
    // 2. Handle Text Messages and Commands
    // ==========================================
    const msg = update.message || update.channel_post;
    if (!msg || !msg.text) return;

    const text = msg.text.trim();
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    const userId = msg.from ? String(msg.from.id) : '';
    console.log(`[Telegram:Message] ChatId: ${chatId}, ThreadId: ${threadId}, UserId: ${userId}, Text: ${text}`);

    if (!text.startsWith('/')) return;

    const parts = text.split(/\s+/);
    const cleanCmd = parts[0].toLowerCase().replace(/@\w+$/, '');

    const isAdmin = userId === adminId || chatId.toString() === (env.TELEGRAM_CHANNEL_ID || '').trim();

    switch (cleanCmd) {
      // ------------------------------------------
      // /settopic <news|report|general>
      // ------------------------------------------
      case '/settopic': {
        if (!isAdmin) {
          await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: '⛔️ شما دسترسی اجرای این دستور را ندارید.' });
          return;
        }
        const target = (parts[1] || '').toLowerCase();
        if (target !== 'news' && target !== 'report' && target !== 'general') {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '⚠️ فرمت نامعتبر است. نحوه استفاده:\n<code>/settopic news</code>\n<code>/settopic report</code>\n<code>/settopic general</code>',
          });
          return;
        }

        await setTopicThreadId(env.DB, target as any, threadId || null);
        await bot.sendMessage({
          chat_id: chatId,
          message_thread_id: threadId,
          text: `✅ تاپیک <b>${target.toUpperCase()}</b> با شناسه <code>${threadId || 'ریشه (General)'}</code> با موفقیت در دیتابیس ثبت شد.`,
        });
        break;
      }

      // ------------------------------------------
      // /topics
      // ------------------------------------------
      case '/topics': {
        const gId = await getTopicThreadId(env, 'general');
        const nId = await getTopicThreadId(env, 'news');
        const rId = await getTopicThreadId(env, 'report');

        const info = `
📌 <b>تنظیمات تاپیک‌های فروم TrendScope:</b>

▫️ <b>General:</b> <code>${gId ?? 'پیش‌فرض (ریشه)'}</code>
▫️ <b>News:</b> <code>${nId ?? 'تنظیم نشده (با /settopic news تنظیم کنید)'}</code>
▫️ <b>Report:</b> <code>${rId ?? 'تنظیم نشده (با /settopic report تنظیم کنید)'}</code>
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: info });
        break;
      }

      case '/start': {
        const welcome = `
🤖 <b>به ربات هوشمند TrendScope خوش آمدید!</b>

👤 <b>شناسه شما:</b> <code>${userId || 'کانال'}</code>
🔐 <b>وضعیت دسترسی:</b> ${userId === adminId ? '✅ مدیر تاییدشده (Admin)' : 'عضو مهمان'}

دستورات در دسترس:
/status - وضعیت پلتفرم و دیتابیس
/refresh - واکشی و انتشار ۵ خبر جدید در تاپیک General
/topics - مشاهده شناسه‌های تاپیک‌های فروم
/settopic - تنظیم شناسه تاپیک‌ها
/selected - خبرهای تأییدشده برای ضبط
/saved - خبرهای ذخیره‌شده
/episode - پکیج ضبط جاری
/help - راهنمای سیستم
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: welcome });
        break;
      }

      case '/help': {
        const help = `
📖 <b>راهنمای جریان کاری TrendScope:</b>

1️⃣ <b>تاپیک General:</b> اخبار خلاصه به صورت خودکار یا با <code>/refresh</code> اینجا منتشر می‌شوند.
   دکمه‌ها: <b>⭐ ذخیره</b> (ارسال به تاپیک News) | <b>❌ رد</b>

2️⃣ <b>تاپیک News:</b> خبرهای ذخیره‌شده از General به اینجا می‌آیند.
   دکمه‌ها: <b>✅ تأیید</b> (انتخاب قطعی برای ضبط ویدیو) | <b>❌ رد</b>

3️⃣ <b>دستورات تکمیلی:</b>
   ▫️ <code>/topics</code> - بررسی تاپیک‌های فروم
   ▫️ <code>/settopic news</code> - تنظیم این تاپیک به عنوان تاپیک اخبار
   ▫️ <code>/status</code> - سلامت سیستم و دیتابیس
   ▫️ <code>/refresh</code> - واکشی دستی ۵ خبر جدید
   ▫️ <code>/selected</code> - لیست خبرهای تأییدشده برای ضبط
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: help });
        break;
      }

      case '/status': {
        const dbCheck = await env.DB.prepare('SELECT count(*) as cnt FROM stories').first<{ cnt: number }>();
        const sourcesCount = await env.DB.prepare('SELECT count(*) as cnt FROM sources WHERE enabled = 1').first<{ cnt: number }>();
        const lastJob = await env.DB.prepare('SELECT * FROM job_executions ORDER BY id DESC LIMIT 1').first<any>();
        const newsThreadId = await getTopicThreadId(env, 'news');

        const statusText = `
📊 <b>وضعیت سیستم TrendScope:</b>

🟢 <b>Cloudflare Worker:</b> فعال و آنلاین
💾 <b>دیتابیس D1:</b> متصل (${dbCheck?.cnt || 0} خبر ثبت‌شده)
📡 <b>منابع فعال:</b> ${sourcesCount?.cnt || 0} منبع
🧠 <b>مدل هوش مصنوعی:</b> Google Gemini 3.5 Flash Lite
⏱ <b>منطقه زمانی:</b> ${env.TIMEZONE}
📌 <b>تاپیک News:</b> ${newsThreadId ? `شناسه ${newsThreadId}` : 'هنوز ست نشده (با /settopic news)'}
🔄 <b>آخرین پردازش:</b> ${lastJob ? `${lastJob.job_type} (${lastJob.status})` : 'هنوز اجرا نشده'}
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: statusText });
        break;
      }

      case '/refresh': {
        if (!isAdmin) {
          await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: '⛔️ شما دسترسی اجرای این دستور را ندارید.' });
          return;
        }

        await bot.sendMessage({
          chat_id: chatId,
          message_thread_id: threadId,
          text: '⏳ <b>فرآیند واکشی و تحلیل ۵ خبر تازه فناوری آغاز شد...</b>\nخبرهای جدید با فرمت بهینه‌شده به تاپیک General ارسال می‌شوند.',
        });

        try {
          const stories = await runNewsPipeline(env, 5, 5.0);
          if (stories.length === 0) {
            await bot.sendMessage({
              chat_id: chatId,
              message_thread_id: threadId,
              text: 'ℹ️ خبر جدیدی در این لحظه یافت نشد (تمام موارد اخیر قبلاً پردازش شده‌اند).',
            });
          } else {
            await bot.sendMessage({
              chat_id: chatId,
              message_thread_id: threadId,
              text: `✅ <b>پردازش تکمیل شد!</b> تعداد ${stories.length} خبر تازه به تاپیک General ارسال گردید.`,
            });
          }
        } catch (err: any) {
          console.error('[Refresh Error]', err);
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: `⚠️ خطا در اجرای فرآیند هوش مصنوعی: ${err.message}`,
          });
        }
        break;
      }

      case '/latest':
      case '/top': {
        const query = cleanCmd === '/top'
          ? 'SELECT * FROM stories ORDER BY combined_score DESC LIMIT 5'
          : 'SELECT * FROM stories ORDER BY created_at DESC LIMIT 5';
        const { results } = await env.DB.prepare(query).all<Story>();

        if (!results || results.length === 0) {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '📭 در حال حاضر خبری در دیتابیس ثبت نشده است.',
          });
          return;
        }

        for (const story of results) {
          const { results: sources } = await env.DB.prepare(`
            SELECT a.title, a.url, s.name as source
            FROM articles a
            JOIN story_articles sa ON a.id = sa.article_id
            JOIN sources s ON a.source_id = s.id
            WHERE sa.story_id = ?
          `)
            .bind(story.id)
            .all<SourceArticleRef>();

          const textMsg = formatStoryGeneralMessage(story, sources || []);
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: textMsg,
            reply_markup: buildGeneralKeyboard(story.id),
          });
        }
        break;
      }

      case '/selected': {
        const { results } = await env.DB.prepare("SELECT * FROM stories WHERE status = 'selected' ORDER BY updated_at DESC").all<Story>();
        if (!results || results.length === 0) {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '🎬 هیچ خبری برای ضبط تأیید نشده است. در تاپیک News دکمه «✅ تأیید» را برای اخبار موردنظر بزنید.',
          });
          return;
        }
        let summary = `🎬 <b>خبرهای تأییدشده نهایی برای ضبط (${results.length} مورد):</b>\n\n`;
        results.forEach((s, idx) => {
          summary += `${idx + 1}. <b>${s.persian_title || s.title}</b>\n`;
        });
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: summary });
        break;
      }

      case '/saved': {
        const { results } = await env.DB.prepare("SELECT * FROM stories WHERE status = 'saved' ORDER BY updated_at DESC").all<Story>();
        if (!results || results.length === 0) {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '⭐ در حال حاضر خبری در وضعیت ذخیره وجود ندارد.',
          });
          return;
        }
        let summary = `⭐ <b>خبرهای ذخیره‌شده (در تاپیک News):</b> (${results.length} مورد)\n\n`;
        results.forEach((s, idx) => {
          summary += `${idx + 1}. <b>${s.persian_title || s.title}</b>\n`;
        });
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: summary });
        break;
      }

      case '/episode': {
        const episode = await env.DB.prepare('SELECT * FROM episodes ORDER BY id DESC LIMIT 1').first<any>();
        if (!episode) {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '📦 هنوز پکیج ضبطی تشکیل نشده است.',
          });
          return;
        }
        const count = await env.DB.prepare('SELECT count(*) as cnt FROM episode_stories WHERE episode_id = ?').bind(episode.id).first<{ cnt: number }>();
        const selCount = await env.DB.prepare('SELECT count(*) as cnt FROM episode_stories WHERE episode_id = ? AND is_selected = 1').bind(episode.id).first<{ cnt: number }>();

        const epText = `
📦 <b>پکیج ضبط: ${episode.title}</b>
⏱ <b>بازه زمانی:</b> ${episode.window_start} الی ${episode.window_end}
📊 <b>کل کاندیدها:</b> ${count?.cnt || 0}
🎬 <b>انتخاب‌شده‌ها برای ویدیو:</b> ${selCount?.cnt || 0}
📌 <b>وضعیت:</b> ${episode.status}
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: epText });
        break;
      }
    }
  } catch (err: any) {
    console.error('[Telegram:HandlerError]', err);
    try {
      const msg = update.message || update.channel_post;
      if (msg) {
        await bot.sendMessage({
          chat_id: msg.chat.id,
          message_thread_id: msg.message_thread_id,
          text: `⚠️ خطا در اجرای دستور: ${err.message}`,
        });
      }
    } catch (e) {
      console.error('[Telegram:HandlerError:NotifyFailed]', e);
    }
  }
}

async function updateMessageStatusBanner(
  bot: TelegramBot,
  message: any,
  banner: string,
  removeButtons: boolean = false
) {
  if (!message || !message.text) return;
  try {
    const originalText = message.text;
    const updatedText = `${originalText}\n\n<i>[${banner}]</i>`;
    await bot.editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: updatedText,
      reply_markup: removeButtons ? { inline_keyboard: [] } : message.reply_markup,
    });
  } catch (err) {
    console.error('[Telegram:updateMessageStatusBanner]', err);
  }
}

async function recordFeedback(db: D1Database, storyId: string, userId: string, action: string) {
  try {
    await db.prepare('INSERT INTO user_feedback (story_id, user_id, action) VALUES (?, ?, ?)')
      .bind(storyId, userId, action)
      .run();
  } catch (err) {
    console.error('[Telegram:recordFeedback]', err);
  }
}
