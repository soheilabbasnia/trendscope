import type { Story, InlineKeyboardMarkup } from '../types.ts';
import { toPersianDigits } from '../utils/persian.ts';
import { decodeHtmlEntities } from '../utils/text.ts';

export interface SourceArticleRef {
  title: string;
  url: string;
  source: string;
}

function isLikelyEnglishText(text?: string | null): boolean {
  if (!text) return false;
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
  const persianCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return latinCount > persianCount && latinCount > 3;
}

export function formatStoryGeneralMessage(story: Story, sources: SourceArticleRef[]): string {
  const persianTitle = decodeHtmlEntities(story.persian_title || story.title);
  const cleanOriginalTitle = decodeHtmlEntities(story.title || '');
  const englishTitle = isLikelyEnglishText(cleanOriginalTitle) && cleanOriginalTitle !== persianTitle
    ? cleanOriginalTitle
    : '';
  const summary = decodeHtmlEntities(story.persian_summary || 'خلاصه در دسترس نیست.');
  const score = story.combined_score ? story.combined_score.toFixed(1) : '0.0';
  const category = story.primary_category || 'عمومی';

  // Build clean verified source links (max 2 sources)
  let sourcesHtml = '';
  if (sources.length > 0) {
    const validSources = sources
      .filter((s) => s.url && s.url.startsWith('http'))
      .slice(0, 2)
      .map((s) => `<a href="${escapeHtml(s.url)}">${escapeHtml(s.source || 'منبع خبر')}</a>`);

    if (validSources.length > 0) {
      sourcesHtml = `\n🔗 <b>منبع:</b> ${validSources.join(' | ')}`;
    }
  }

  let text = `🔥 <b>${escapeHtml(persianTitle)}</b>`;
  if (englishTitle) {
    text += `\n<i>${escapeHtml(englishTitle)}</i>`;
  }
  text += `\n\n📝 <b>خلاصه:</b>\n${escapeHtml(summary)}`;
  text += `\n\n📊 <b>امتیاز:</b> ${toPersianDigits(score)}/۱۰ | 🎯 <b>دسته‌بندی:</b> ${escapeHtml(category)}`;
  if (sourcesHtml) {
    text += sourcesHtml;
  }

  return text;
}

export function formatStoryNewsMessage(story: Story, sources: SourceArticleRef[]): string {
  const baseContent = formatStoryGeneralMessage(story, sources);
  return `📌 <b>[خبر تأییدشده]</b>\n\n${baseContent}`;
}

export function buildGeneralKeyboard(storyId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ تأیید', callback_data: `approve:${storyId}` },
        { text: '❌ رد', callback_data: `reject:${storyId}` },
      ],
    ],
  };
}

export function buildNewsKeyboard(storyId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ تأیید', callback_data: `approve:${storyId}` },
        { text: '❌ رد', callback_data: `reject_news:${storyId}` },
      ],
    ],
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
