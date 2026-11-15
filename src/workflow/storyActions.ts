import type { Env, Story } from '../types.ts';
import { updateTastePreference } from '../news/ranker.ts';
import { TelegramBot } from '../telegram/bot.ts';
import { formatStoryNewsMessage, type SourceArticleRef } from '../telegram/formatters.ts';
import { getTopicThreadId } from '../telegram/topics.ts';

export interface ActionActor {
  type: 'telegram' | 'dashboard';
  userId: string;
  originalMessage?: any;
}

export interface ActionResult {
  success: boolean;
  message: string;
  story?: Story;
}

/**
 * Approve a story (New/Alerted -> Approved)
 * Shared between Telegram inline button and Dashboard API
 */
export async function approveStory(
  env: Env,
  storyId: string,
  actor: ActionActor
): Promise<ActionResult> {
  const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());

  // 1. Fetch story
  const story = await env.DB.prepare('SELECT * FROM stories WHERE id = ?')
    .bind(storyId)
    .first<Story>();

  if (!story) {
    return { success: false, message: 'خبر مورد نظر در سیستم یافت نشد.' };
  }

  // 2. Idempotency check: if already approved, return success
  if (story.status === 'approved' || story.status === 'selected') {
    return { success: true, message: 'این خبر قبلاً تأیید شده است.', story };
  }

  // 3. Update status in D1 to 'approved'
  await env.DB.prepare("UPDATE stories SET status = 'approved', updated_at = datetime('now') WHERE id = ?")
    .bind(storyId)
    .run();

  // 4. Record positive feedback for Channel Taste Engine
  try {
    await env.DB.prepare('INSERT INTO user_feedback (story_id, user_id, action) VALUES (?, ?, ?)')
      .bind(storyId, actor.userId, 'approve')
      .run();

    if (story.primary_category) {
      const entities = story.entities ? JSON.parse(story.entities) : [];
      await updateTastePreference(env.DB, story.primary_category, entities, 'approve');
    }
  } catch (err) {
    console.error('[Action:Approve] Taste preference update error:', err);
  }

  // 5. Publish to Telegram News topic (read-only, no action buttons)
  const alreadyInNews = await env.DB.prepare(
    "SELECT id FROM telegram_deliveries WHERE story_id = ? AND delivery_type = 'news'"
  )
    .bind(storyId)
    .first<{ id: number }>();

  if (!alreadyInNews) {
    try {
      // Query source articles
      const { results: sources } = await env.DB.prepare(`
        SELECT a.title, a.url, s.name as source
        FROM articles a
        JOIN story_articles sa ON a.id = sa.article_id
        JOIN sources s ON a.source_id = s.id
        WHERE sa.story_id = ?
      `)
        .bind(storyId)
        .all<SourceArticleRef>();

      const newsThreadId = await getTopicThreadId(env, 'news');
      const targetChatId = (env.TELEGRAM_CHANNEL_ID || '').trim();

      // Read-only News message format without management buttons
      const newsText = formatStoryNewsMessage(story, sources || []);

      const sendRes = await bot.sendMessage({
        chat_id: targetChatId,
        message_thread_id: newsThreadId,
        text: newsText,
      });

      if (sendRes?.ok && sendRes.result?.message_id) {
        await env.DB.prepare(`
          INSERT INTO telegram_deliveries (story_id, chat_id, message_thread_id, message_id, delivery_type)
          VALUES (?, ?, ?, ?, 'news')
        `)
          .bind(storyId, targetChatId, newsThreadId || null, sendRes.result.message_id)
          .run();
      } else {
        console.warn('[Action:Approve] Failed to send to News topic:', sendRes);
      }
    } catch (e: any) {
      console.error('[Action:Approve] Error sending to News topic:', e.message);
    }
  }

  // 6. Update the original General Telegram message to reflect approval without extra buttons
  try {
    const generalDelivery = await env.DB.prepare(`
      SELECT chat_id, message_id FROM telegram_deliveries
      WHERE story_id = ? AND delivery_type = 'general'
      ORDER BY id DESC LIMIT 1
    `)
      .bind(storyId)
      .first<{ chat_id: string; message_id: number }>();

    const targetChat = actor.originalMessage?.chat?.id || generalDelivery?.chat_id;
    const targetMsgId = actor.originalMessage?.message_id || generalDelivery?.message_id;

    if (targetChat && targetMsgId) {
      const origText = actor.originalMessage?.text;
      const baseText = origText || story.persian_title || story.title;
      await bot.editMessageText({
        chat_id: targetChat,
        message_id: targetMsgId,
        text: `${baseText}\n\n<i>[✅ این خبر تأیید شد و به تاپیک اخبار ارسال گردید]</i>`,
        reply_markup: { inline_keyboard: [] },
      });
    }
  } catch (err) {
    console.error('[Action:Approve] Error updating original General message:', err);
  }

  story.status = 'approved';
  return { success: true, message: 'خبر با موفقیت تأیید شد و به تاپیک اخبار انتقال یافت.', story };
}

/**
 * Reject a story (New/Alerted -> Rejected)
 * Shared between Telegram inline button and Dashboard API
 */
export async function rejectStory(
  env: Env,
  storyId: string,
  actor: ActionActor
): Promise<ActionResult> {
  const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());

  // 1. Fetch story
  const story = await env.DB.prepare('SELECT * FROM stories WHERE id = ?')
    .bind(storyId)
    .first<Story>();

  if (!story) {
    return { success: false, message: 'خبر مورد نظر در سیستم یافت نشد.' };
  }

  // 2. Idempotency check: if already rejected, return success
  if (story.status === 'rejected') {
    return { success: true, message: 'این خبر قبلاً رد شده است.', story };
  }

  // 3. Update status in D1 to 'rejected'
  await env.DB.prepare("UPDATE stories SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
    .bind(storyId)
    .run();

  // 4. Record negative preference feedback for Taste Engine
  try {
    await env.DB.prepare('INSERT INTO user_feedback (story_id, user_id, action) VALUES (?, ?, ?)')
      .bind(storyId, actor.userId, 'reject')
      .run();

    if (story.primary_category) {
      const entities = story.entities ? JSON.parse(story.entities) : [];
      await updateTastePreference(env.DB, story.primary_category, entities, 'reject');
    }
  } catch (err) {
    console.error('[Action:Reject] Taste preference update error:', err);
  }

  // 5. Update original General Telegram message to reflect rejection with buttons removed
  try {
    const generalDelivery = await env.DB.prepare(`
      SELECT chat_id, message_id FROM telegram_deliveries
      WHERE story_id = ? AND delivery_type = 'general'
      ORDER BY id DESC LIMIT 1
    `)
      .bind(storyId)
      .first<{ chat_id: string; message_id: number }>();

    const targetChat = actor.originalMessage?.chat?.id || generalDelivery?.chat_id;
    const targetMsgId = actor.originalMessage?.message_id || generalDelivery?.message_id;

    if (targetChat && targetMsgId) {
      const origText = actor.originalMessage?.text;
      const baseText = origText || story.persian_title || story.title;
      await bot.editMessageText({
        chat_id: targetChat,
        message_id: targetMsgId,
        text: `${baseText}\n\n<i>[❌ این خبر رد شد]</i>`,
        reply_markup: { inline_keyboard: [] },
      });
    }
  } catch (err) {
    console.error('[Action:Reject] Error updating original General message:', err);
  }

  // 6. If previously delivered to News topic, remove it from News topic
  try {
    const newsDelivery = await env.DB.prepare(`
      SELECT chat_id, message_id FROM telegram_deliveries
      WHERE story_id = ? AND delivery_type = 'news'
      ORDER BY id DESC LIMIT 1
    `)
      .bind(storyId)
      .first<{ chat_id: string; message_id: number }>();

    if (newsDelivery?.chat_id && newsDelivery?.message_id) {
      await bot.deleteMessage({
        chat_id: newsDelivery.chat_id,
        message_id: newsDelivery.message_id,
      });
      await env.DB.prepare("DELETE FROM telegram_deliveries WHERE story_id = ? AND delivery_type = 'news'")
        .bind(storyId)
        .run();
    }
  } catch (err) {
    console.warn('[Action:Reject] Could not remove message from News topic:', err);
  }

  story.status = 'rejected';
  return { success: true, message: 'خبر رد شد و از چرخه بررسی کنار گذاشته شد.', story };
}
