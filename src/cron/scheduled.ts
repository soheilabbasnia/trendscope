import { Env, Story } from '../types';
import { runNewsPipeline } from '../news/pipeline';
import { TelegramBot } from '../telegram/bot';
import { getTopicThreadId } from '../telegram/topics';

export async function handleScheduledEvent(event: ScheduledEvent, env: Env): Promise<void> {
  const cron = event.cron;
  console.log(`[Scheduled] Handling cron: "${cron}" at ${new Date().toISOString()}`);

  // 1. Monday & Friday 07:00 Asia/Tehran (03:30 UTC): Episode Package Generation
  if (cron === '30 3 * * 1,5') {
    await generateEpisodePackage(env);
    return;
  }

  // 2. 12-Hour Automated Discovery Cycle
  await handleTwelveHourDiscovery(env);
}

export async function handleTwelveHourDiscovery(env: Env): Promise<void> {
  console.log('[Cron:12h] Running 12-hour discovery cycle...');
  try {
    const stories = await runNewsPipeline(env, 5, 7.0);
    console.log(`[Cron:12h] Completed cycle. Alerted ${stories.length} stories.`);
  } catch (err: any) {
    console.error('[Cron:12h] Error during scheduled discovery:', err.message);
  }
}

export async function generateEpisodePackage(env: Env): Promise<any> {
  console.log('[Episode] Generating recording-day package...');
  const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
  const now = new Date();

  // Run bounded catch-up discovery first
  try {
    await runNewsPipeline(env, 5, 6.0);
  } catch (e: any) {
    console.warn('[Episode] Catch-up check error:', e.message);
  }

  // Window calculation
  const dayOfWeek = now.getUTCDay();
  const isMonday = dayOfWeek === 1;

  const windowDays = isMonday ? 3 : 4;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = now.toISOString();

  const episodeCode = `EP-${now.toISOString().split('T')[0]}-${isMonday ? 'MON' : 'FRI'}`;
  const title = isMonday ? 'پکیج ضبط ویدیوی دوشنبه' : 'پکیج ضبط ویدیوی جمعه';

  let episode = await env.DB.prepare('SELECT * FROM episodes WHERE episode_code = ?')
    .bind(episodeCode)
    .first<any>();

  if (!episode) {
    const insertRes = await env.DB.prepare(`
      INSERT INTO episodes (episode_code, title, window_start, window_end, status)
      VALUES (?, ?, ?, ?, 'draft')
    `)
      .bind(episodeCode, title, windowStart, windowEnd)
      .run();

    episode = {
      id: insertRes.meta.last_row_id,
      episode_code: episodeCode,
      title,
      window_start: windowStart,
      window_end: windowEnd,
      status: 'draft',
    };
  }

  // Query qualified stories in this window
  const { results: stories } = await env.DB.prepare(`
    SELECT * FROM stories
    WHERE created_at >= ? AND created_at < ? AND status != 'rejected'
    ORDER BY combined_score DESC
    LIMIT 25
  `)
    .bind(windowStart, windowEnd)
    .all<Story>();

  if (!stories || stories.length === 0) {
    console.log('[Episode] No qualified stories found in window.');
    return { episode, count: 0 };
  }

  // Insert candidates into episode_stories
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    await env.DB.prepare(`
      INSERT OR IGNORE INTO episode_stories (episode_id, story_id, rank_order)
      VALUES (?, ?, ?)
    `).bind(episode.id, s.id, i + 1).run();
  }

  // Query already approved stories
  const { results: selectedStories } = await env.DB.prepare(`
    SELECT s.* FROM stories s
    JOIN episode_stories es ON s.id = es.story_id
    WHERE es.episode_id = ? AND es.is_selected = 1
  `).bind(episode.id).all<Story>();

  let summaryText = `
🎬 <b>پکیج اختصاصی ضبط یوتیوب: ${title}</b>
⏱ <b>بازه بررسی:</b> ${isMonday ? 'جمعه تا دوشنبه' : 'دوشنبه تا جمعه'}
📊 <b>تعداد کل کاندیدها:</b> ${stories.length} خبر
✅ <b>تأییدشده‌های نهایی برای ویدیو:</b> ${selectedStories?.length || 0} خبر

<b>برترین کاندیدهای واجد شرایط:</b>
  `.trim();

  stories.slice(0, 15).forEach((s, idx) => {
    const isSel = selectedStories?.some((sel) => sel.id === s.id);
    summaryText += `\n${idx + 1}. ${isSel ? '✅' : '▫️'} <b>${s.persian_title || s.title}</b> (امتیاز: ${s.combined_score.toFixed(1)})`;
  });

  summaryText += '\n\n💡 <i>برای اضافه کردن هر خبر به لیست نهایی ضبط، در تاپیک News دکمه «✅ تأیید» را انتخاب کنید.</i>';

  const targetChatId = (env.TELEGRAM_CHANNEL_ID || '').trim();
  // Deliver package report to Report topic if configured, otherwise General
  const reportThreadId = (await getTopicThreadId(env, 'report')) || (await getTopicThreadId(env, 'general'));

  await bot.sendMessage({
    chat_id: targetChatId,
    message_thread_id: reportThreadId,
    text: summaryText,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎬 مشاهده لیست تأییدشده‌ها', callback_data: 'view:selected' },
        ],
      ],
    },
  });

  return { episode, count: stories.length };
}
