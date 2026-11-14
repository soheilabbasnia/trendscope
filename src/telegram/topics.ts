import { Env } from '../types';

export async function getTopicThreadId(
  env: Env,
  topicName: 'general' | 'news' | 'report'
): Promise<number | undefined> {
  // Check D1 settings first
  try {
    const settingKey = `topic_${topicName}_id`;
    const record = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
      .bind(settingKey)
      .first<{ value: string }>();

    if (record && record.value && record.value !== '0' && record.value !== 'null') {
      const parsed = parseInt(record.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[Topics] Failed to query setting for topic ${topicName}:`, err);
  }

  // Fallbacks
  if (topicName === 'news' && (env as any).TELEGRAM_TOPIC_NEWS_ID) {
    const parsed = parseInt((env as any).TELEGRAM_TOPIC_NEWS_ID, 10);
    if (!isNaN(parsed)) return parsed;
  }

  if (topicName === 'report' && (env as any).TELEGRAM_TOPIC_REPORT_ID) {
    const parsed = parseInt((env as any).TELEGRAM_TOPIC_REPORT_ID, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // For General topic, thread ID is undefined (default supergroup forum root)
  return undefined;
}

export async function setTopicThreadId(
  db: D1Database,
  topicName: 'general' | 'news' | 'report',
  threadId: number | null
): Promise<void> {
  const settingKey = `topic_${topicName}_id`;
  const val = threadId ? threadId.toString() : '0';

  await db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `).bind(settingKey, val).run();
}
