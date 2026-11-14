import { Env, TelegramUpdate, Story, InlineKeyboardMarkup } from '../types';
import { TelegramBot } from './bot';
import { runNewsPipeline } from '../news/pipeline';
import { updateTastePreference } from '../news/ranker';

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
  const adminId = (env.TELEGRAM_ADMIN_ID || '').trim();

  try {
    // 1. Handle Callback Queries (Inline button clicks)
    if (update.callback_query) {
      const cb = update.callback_query;
      const userId = String(cb.from.id);
      const data = cb.data || '';
      console.log(`[Telegram:Callback] From: ${userId}, Data: ${data}`);

      // Handle general views like view:selected
      if (data === 'view:selected') {
        const { results } = await env.DB.prepare("SELECT * FROM stories WHERE status = 'selected' ORDER BY updated_at DESC").all<Story>();
        let summary = `🎬 <b>خبرهای منتخب برای ضبط (${results?.length || 0} مورد):</b>\n\n`;
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

      // Security check: Only configured admin can interact
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

      const currentStory = await env.DB.prepare('SELECT * FROM stories WHERE id = ?').bind(storyId).first<Story>();

      if (action === 'save') {
        await env.DB.prepare("UPDATE stories SET status = 'saved', updated_at = datetime('now') WHERE id = ?").bind(storyId).run();
        await recordFeedback(env.DB, storyId, userId, 'save');
        if (currentStory) {
          const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
          await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'save');
        }
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '⭐ خبر ذخیره شد.' });
        await updateMessageStatusBanner(bot, cb.message, '⭐ در لیست ذخیره‌شده‌ها قرار گرفت');
      } else if (action === 'select') {
        await env.DB.prepare("UPDATE stories SET status = 'selected', updated_at = datetime('now') WHERE id = ?").bind(storyId).run();
        await recordFeedback(env.DB, storyId, userId, 'select');
        if (currentStory) {
          const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
          await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'select');
        }
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '🎬 خبر برای ضبط ویدیو انتخاب شد.' });
        await updateMessageStatusBanner(bot, cb.message, '🎬 انتخاب‌شده برای ضبط ویدیو');
      } else if (action === 'reject') {
        await env.DB.prepare("UPDATE stories SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").bind(storyId).run();
        await recordFeedback(env.DB, storyId, userId, 'reject');
        if (currentStory) {
          const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
          await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'reject');
        }
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '❌ خبر رد شد.' });
        await updateMessageStatusBanner(bot, cb.message, '❌ این خبر رد شد');
      } else if (action === 'cover') {
        await env.DB.prepare("UPDATE stories SET status = 'covered', updated_at = datetime('now') WHERE id = ?").bind(storyId).run();
        await recordFeedback(env.DB, storyId, userId, 'cover');
        if (currentStory) {
          const entities = currentStory.entities ? JSON.parse(currentStory.entities) : [];
          await updateTastePreference(env.DB, currentStory.primary_category || '', entities, 'cover');
        }
        await bot.answerCallbackQuery({ callback_query_id: cb.id, text: '✅ وضعیت به پوشش‌داده‌شده تغییر یافت.' });
        await updateMessageStatusBanner(bot, cb.message, '✅ در ویدیو پوشش داده شد');
      } else if (action === 'details') {
        if (!currentStory) {
          await bot.answerCallbackQuery({ callback_query_id: cb.id, text: 'خبر یافت نشد.' });
          return;
        }
        const detailsText = `
<b>🔍 جزییات تکمیلی تحلیل:</b>

💡 <b>زاویه و ایده ضبط یوتیوب:</b>
${currentStory.youtube_angle || 'ثبت نشده'}

🔥 <b>حواشی و نظرات:</b>
${currentStory.controversy_details || 'بدون حاشیه خاص'}

🗣 <b>واکنش‌های رسمی:</b>
${currentStory.verified_reactions || 'ثبت نشده'}
        `.trim();
        await bot.sendMessage({
          chat_id: cb.message?.chat.id || cb.from.id,
          message_thread_id: cb.message?.message_thread_id,
          text: detailsText,
        });
        await bot.answerCallbackQuery({ callback_query_id: cb.id });
      }
      return;
    }

    // 2. Handle Text Messages and Commands
    const msg = update.message || update.channel_post;
    if (!msg || !msg.text) return;

    const text = msg.text.trim();
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    const userId = msg.from ? String(msg.from.id) : '';
    console.log(`[Telegram:Message] ChatId: ${chatId}, UserId: ${userId}, Text: ${text}`);

    if (!text.startsWith('/')) return;

    const [cmd] = text.split(' ');
    const cleanCmd = cmd.toLowerCase().replace(/@\w+$/, '');

    // Check admin authorization for management commands
    const isAdmin = userId === adminId || chatId.toString() === (env.TELEGRAM_CHANNEL_ID || '').trim();

    switch (cleanCmd) {
      case '/start': {
        const welcome = `
🤖 <b>به ربات هوشمند TrendScope خوش آمدید!</b>

پلتفرم پایش اخبار فناوری و ترندهای یوتیوب.
👤 <b>شناسه شما:</b> <code>${userId || 'کانال'}</code>
🔐 <b>وضعیت دسترسی:</b> ${userId === adminId ? '✅ مدیر تاییدشده (Admin)' : 'عضو مهمان'}

دستورات در دسترس:
/status - وضعیت پلتفرم و دیتابیس
/refresh - استخراج و تحلیل ۵ خبر برتر فناوری با Gemini
/latest - جدیدترین خبرهای تحلیل‌شده
/top - مهم‌ترین خبرهای رتبه‌بندی‌شده
/selected - خبرهای منتخب ضبط این هفته
/saved - خبرهای ذخیره‌شده
/episode - پکیج ضبط جاری
/help - راهنمای سیستم
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: welcome });
        break;
      }

      case '/help': {
        const help = `
📖 <b>راهنمای دستورات TrendScope:</b>

▫️ <b>/status:</b> نمایش وضعیت سرور Cloudflare، دیتابیس D1 و کرون جاب‌ها.
▫️ <b>/refresh:</b> استخراج ۵ خبر تازه فناوری و تحلیل با هوش مصنوعی.
▫️ <b>/latest:</b> فهرست خبرهای اخیر همراه با دکمه‌های تعاملی.
▫️ <b>/top:</b> فهرست باکیفیت‌ترین خبرها بر اساس امتیاز ترکیبی.
▫️ <b>/selected:</b> خبرهایی که برای ضبط ویدیوی دوشنبه یا جمعه انتخاب شده‌اند.
▫️ <b>/saved:</b> آرشیو خبرهایی که ذخیره کرده‌اید.
▫️ <b>/episode:</b> پکیج آماده‌سازی ویدیوی جاری (تولید خودکار دوشنبه و جمعه ۰۷:۰۰).
        `.trim();
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: help });
        break;
      }

      case '/status': {
        const dbCheck = await env.DB.prepare("SELECT count(*) as cnt FROM stories").first<{ cnt: number }>();
        const sourcesCount = await env.DB.prepare("SELECT count(*) as cnt FROM sources WHERE enabled = 1").first<{ cnt: number }>();
        const lastJob = await env.DB.prepare("SELECT * FROM job_executions ORDER BY id DESC LIMIT 1").first<any>();

        const statusText = `
📊 <b>وضعیت سیستم TrendScope:</b>

🟢 <b>Cloudflare Worker:</b> فعال و آنلاین
💾 <b>دیتابیس D1:</b> متصل (${dbCheck?.cnt || 0} خبر ثبت‌شده)
📡 <b>منابع فعال:</b> ${sourcesCount?.cnt || 0} منبع
🧠 <b>مدل هوش مصنوعی:</b> Google Gemini 3.5 Flash Lite
⏱ <b>منطقه زمانی:</b> ${env.TIMEZONE}
🔄 <b>آخرین پردازش:</b> ${lastJob ? `${lastJob.job_type} (${lastJob.status})` : 'هنوز اجرا نشده'}
⏰ <b>پکیج خودکار ضبط:</b> دوشنبه و جمعه ساعت ۰۷:۰۰ صبح
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
          text: '⏳ <b>فرآیند واکشی و تحلیل ۵ خبر تازه فناوری با هوش مصنوعی Gemini آغاز شد...</b>\nخبرهای تحلیل‌شده به محض آماده‌سازی به گروه ارسال می‌شوند.',
        });

        try {
          // Process 5 stories as requested
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
              text: `✅ <b>پردازش تکمیل شد!</b> تعداد ${stories.length} خبر تازه فناوری با موفقیت به گروه ارسال گردید.`,
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
          ? "SELECT * FROM stories ORDER BY combined_score DESC LIMIT 5"
          : "SELECT * FROM stories ORDER BY created_at DESC LIMIT 5";
        const { results } = await env.DB.prepare(query).all<Story>();

        if (!results || results.length === 0) {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '📭 در حال حاضر خبری در دیتابیس ثبت نشده است. با ارسال /refresh فرآیند پویش را آغاز کنید.',
          });
          return;
        }

        for (const story of results) {
          await sendStoryCard(bot, chatId, threadId, story);
        }
        break;
      }

      case '/selected': {
        const { results } = await env.DB.prepare("SELECT * FROM stories WHERE status = 'selected' ORDER BY updated_at DESC").all<Story>();
        if (!results || results.length === 0) {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '🎬 هیچ خبری برای ضبط انتخاب نشده است. برای انتخاب خبر، از دکمه «🎬 انتخاب برای ضبط» روی خبرها استفاده کنید.',
          });
          return;
        }
        let summary = `🎬 <b>خبرهای منتخب برای ضبط (${results.length} مورد):</b>\n\n`;
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
            text: '⭐ در حال حاضر خبر ذخیره‌شده‌ای ندارید.',
          });
          return;
        }
        let summary = `⭐ <b>خبرهای ذخیره‌شده (${results.length} مورد):</b>\n\n`;
        results.forEach((s, idx) => {
          summary += `${idx + 1}. <b>${s.persian_title || s.title}</b>\n`;
        });
        await bot.sendMessage({ chat_id: chatId, message_thread_id: threadId, text: summary });
        break;
      }

      case '/episode': {
        const episode = await env.DB.prepare("SELECT * FROM episodes ORDER BY id DESC LIMIT 1").first<any>();
        if (!episode) {
          await bot.sendMessage({
            chat_id: chatId,
            message_thread_id: threadId,
            text: '📦 هنوز پکیج ضبطی تشکیل نشده است. پکیج‌ها به صورت خودکار دوشنبه‌ها و جمعه‌ها در ساعت ۰۷:۰۰ صبح تولید می‌شوند.',
          });
          return;
        }
        const count = await env.DB.prepare("SELECT count(*) as cnt FROM episode_stories WHERE episode_id = ?").bind(episode.id).first<{ cnt: number }>();
        const epText = `
📦 <b>پکیج ضبط: ${episode.title}</b>
⏱ <b>بازه زمانی:</b> ${episode.window_start} الی ${episode.window_end}
📊 <b>تعداد کل کاندیدها:</b> ${count?.cnt || 0}
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

async function updateMessageStatusBanner(bot: TelegramBot, message: any, banner: string) {
  if (!message || !message.text) return;
  try {
    const originalText = message.text;
    const updatedText = `${originalText}\n\n<i>[${banner}]</i>`;
    await bot.editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: updatedText,
      reply_markup: message.reply_markup,
    });
  } catch (err) {
    console.error('[Telegram:updateMessageStatusBanner]', err);
  }
}

async function recordFeedback(db: D1Database, storyId: string, userId: string, action: string) {
  try {
    await db.prepare("INSERT INTO user_feedback (story_id, user_id, action) VALUES (?, ?, ?)").bind(storyId, userId, action).run();
  } catch (err) {
    console.error('[Telegram:recordFeedback]', err);
  }
}

export function buildStoryKeyboard(storyId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🎬 انتخاب برای ضبط', callback_data: `select:${storyId}` },
        { text: '⭐ ذخیره', callback_data: `save:${storyId}` },
      ],
      [
        { text: '🔍 جزییات و ایده ضبط', callback_data: `details:${storyId}` },
        { text: '❌ رد خبر', callback_data: `reject:${storyId}` },
      ],
    ],
  };
}

export async function sendStoryCard(bot: TelegramBot, chatId: number | string, threadId: number | undefined, story: Story) {
  const card = `
🔥 <b>${story.persian_title || story.title}</b>
<i>${story.title}</i>

📝 <b>خلاصه فارسی:</b>
${story.persian_summary || 'خلاصه در دسترس نیست.'}

💡 <b>چرا اهمیت دارد؟</b>
${story.why_it_matters || 'تحلیل ثبت نشده.'}

🎬 <b>ایده ضبط برای مجری:</b>
${story.youtube_angle || 'ثبت نشده.'}

📊 <b>امتیاز:</b> ${story.combined_score.toFixed(1)}/10 | 🎯 <b>دسته‌بندی:</b> ${story.primary_category || 'عمومی'}
  `.trim();

  await bot.sendMessage({
    chat_id: chatId,
    message_thread_id: threadId,
    text: card,
    reply_markup: buildStoryKeyboard(story.id),
  });
}
