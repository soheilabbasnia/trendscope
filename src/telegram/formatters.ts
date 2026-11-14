import { Story, InlineKeyboardMarkup } from '../types';

export interface SourceArticleRef {
  title: string;
  url: string;
  source: string;
}

export function formatStoryGeneralMessage(story: Story, sources: SourceArticleRef[]): string {
  const persianTitle = story.persian_title || story.title;
  const englishTitle = story.title && story.title !== persianTitle ? story.title : '';
  const summary = story.persian_summary || 'خلاصه در دسترس نیست.';
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
  text += `\n\n📊 <b>امتیاز:</b> ${score}/10 | 🎯 <b>دسته‌بندی:</b> ${escapeHtml(category)}`;
  if (sourcesHtml) {
    text += sourcesHtml;
  }

  return text;
}

export function formatStoryNewsMessage(story: Story, sources: SourceArticleRef[]): string {
  const baseContent = formatStoryGeneralMessage(story, sources);
  return `📌 <b>[خبر ذخیره‌شده — در انتظار انتخاب برای ضبط]</b>\n\n${baseContent}`;
}

export function buildGeneralKeyboard(storyId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '⭐ ذخیره', callback_data: `save:${storyId}` },
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
