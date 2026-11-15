import { Env, TelegramUpdate, Story } from '../types';
import { TelegramBot } from './bot';
import { runNewsPipeline } from '../news/pipeline';
import { updateTastePreference } from '../news/ranker';
import {
  formatStoryGeneralMessage,
  formatStoryNewsMessage,
  buildGeneralKeyboard,
  SourceArticleRef,
} from './formatters';
import { getTopicThreadId, setTopicThreadId } from './topics';
import { approveStory, rejectStory } from '../workflow/storyActions';
import { toPersianDigits } from '../utils/persian.ts';

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
      // ACTION: APPROVE / SAVE (General or News)
      // ------------------------------------------
      if (action === 'approve' || action === 'save') {
        const result = await approveStory(env, storyId, {
          type: 'telegram',
          userId,
          originalMessage: cb.message,
        });
        await bot.answerCallbackQuery({
          callback_query_id: cb.id,
          text: result.message,
          show_alert: !result.success,
        });
        return;
      }

      // ------------------------------------------
      // ACTION: REJECT / REJECT_NEWS (General or News)
      // ------------------------------------------
      if (action === 'reject' || action === 'reject_news') {
        const result = await rejectStory(env, storyId, {
          type: 'telegram',
          userId,
          originalMessage: cb.message,
        });
        await bot.answerCallbackQuery({
          callback_query_id: cb.id,
          text: result.message,
          show_alert: !result.success,
        });
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

👤 <b>شناسه شما:</b> <code>${toPersianDigits(userId) || 'کانال'}</code>
🔐 <b>وضعیت دسترسی:</b> ${userId === adminId ? '✅ مدیر تاییدشده (Admin)' : 'عضو مهمان'}

دستورات در دسترس:
/status - وضعیت پلتفرم، پایگاه داده و هوش مصنوعی
/refresh - واکشی و تحلیل ۵ خبر تازه فناوری
/topics - مشاهده شناسه‌های تاپیک‌های فروم
/settopic - تنظیم شناسه تاپیک‌ها
/help - راهنمای سیستم و چرخه کار
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: welcome });
        break;
      }

      case '/help': {
        const help = `
📖 <b>راهنمای چرخه کار یکپارچه TrendScope:</b>

1️⃣ <b>تاپیک General (صف بررسی):</b> اخبار مهم فناوری با امتیاز بالاتر از ۸.۵ منتشر می‌شوند.
   دکمه‌ها: <b>✅ تأیید</b> (انتقال به News و ثبت در داشبورد) | <b>❌ رد</b>

2️⃣ <b>تاپیک News (خبرها):</b> آرشیو فقط‌خواندنی خبرهای تأییدشده.
   <i>(جهت حذف یا اصلاح اضطراری خبرها، از پنل مدیریت وب استفاده نمایید)</i>

3️⃣ <b>داشبورد وب:</b>
   🔗 پایش بلادرنگ، فیلتر دسته‌بندی و مدیریت اخبار در پنل مدیریتی.

▫️ <code>/status</code> - وضعیت سلامت سیستم و دیتابیس
▫️ <code>/refresh</code> - واکشی دستی ۵ خبر جدید
▫️ <code>/topics</code> - بررسی تنظیمات تاپیک‌های فروم
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: help });
        break;
      }

      case '/status': {
        const dbCheck = await env.DB.prepare('SELECT count(*) as cnt FROM stories').first<{ cnt: number }>();
        const sourcesCount = await env.DB.prepare('SELECT count(*) as cnt FROM sources WHERE enabled = 1').first<{ cnt: number }>();
        const pendingCount = await env.DB.prepare("SELECT count(*) as cnt FROM stories WHERE status IN ('new', 'alerted', 'general') AND combined_score > 8.5").first<{ cnt: number }>();
        const approvedCount = await env.DB.prepare("SELECT count(*) as cnt FROM stories WHERE status IN ('approved', 'selected')").first<{ cnt: number }>();
        const lastJob = await env.DB.prepare('SELECT * FROM job_executions ORDER BY id DESC LIMIT 1').first<any>();
        const newsThreadId = await getTopicThreadId(env, 'news');

        const statusText = `
📊 <b>وضعیت سیستم TrendScope:</b>

🟢 <b>Cloudflare Worker:</b> فعال و آنلاین
💾 <b>دیتابیس D1:</b> متصل (${toPersianDigits(dbCheck?.cnt || 0)} خبر ثبت‌شده)
📥 <b>صف خبرخوان (Pending):</b> ${toPersianDigits(pendingCount?.cnt || 0)} خبر
✅ <b>خبرهای تأییدشده:</b> ${toPersianDigits(approvedCount?.cnt || 0)} خبر
📡 <b>منابع فعال:</b> ${toPersianDigits(sourcesCount?.cnt || 0)} منبع
🧠 <b>مدل هوش مصنوعی:</b> Google Gemini 3.5 Flash Lite
⏱ <b>منطقه زمانی:</b> ${env.TIMEZONE}
📌 <b>تاپیک News:</b> ${newsThreadId ? `شناسه ${toPersianDigits(newsThreadId)}` : 'تنظیم نشده (با /settopic news)'}
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
          const stories = await runNewsPipeline(env, 5);
          if (stories.length === 0) {
            await bot.sendMessage({
              chat_id: chatId,
              message_thread_id: threadId,
              text: 'ℹ️ خبر جدیدی با امتیاز بالای ۸.۵ در این لحظه یافت نشد.',
            });
          } else {
            await bot.sendMessage({
              chat_id: chatId,
              message_thread_id: threadId,
              text: `✅ <b>پردازش تکمیل شد!</b> تعداد ${stories.length} خبر برتر فناوری با امتیاز بالاتر از ۸.۵ به تاپیک General ارسال گردید.`,
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
          ? "SELECT * FROM stories WHERE status NOT IN ('rejected', 'filtered_non_tech', 'filtered_low_score') AND combined_score > 8.5 ORDER BY combined_score DESC LIMIT 5"
          : "SELECT * FROM stories WHERE status NOT IN ('rejected', 'filtered_non_tech', 'filtered_low_score') AND combined_score > 8.5 ORDER BY created_at DESC LIMIT 5";
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
