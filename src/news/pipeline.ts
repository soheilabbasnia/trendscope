import { Env, Story } from '../types';
import { fetchTopTechNews } from './fetcher';
import { analyzeNewsWithGemini } from '../ai/gemini';
import { TelegramBot } from '../telegram/bot';
import { sendStoryCard } from '../telegram/handlers';

export async function runNewsPipeline(env: Env, limit: number = 1): Promise<Story[]> {
  console.log(`[Pipeline] Starting news pipeline with limit: ${limit}`);
  const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
  const processedStories: Story[] = [];

  // 1. Fetch fresh tech news
  const articles = await fetchTopTechNews(limit);
  console.log(`[Pipeline] Fetched ${articles.length} raw articles.`);

  for (const article of articles) {
    // 2. Deduplication check by URL
    const existingArticle = await env.DB.prepare('SELECT id FROM articles WHERE url = ?')
      .bind(article.url)
      .first<{ id: number }>();

    if (existingArticle) {
      console.log(`[Pipeline] Article already processed: ${article.url}`);
      continue;
    }

    // 3. AI Analysis with Gemini
    console.log(`[Pipeline] Analyzing story with Gemini: "${article.title}"`);
    const aiResult = await analyzeNewsWithGemini(article, env.GEMINI_API_KEY);

    const storyId = crypto.randomUUID();
    const combinedScore = (aiResult.importance_score + aiResult.relevance_score) / 2;

    // 4. Save to D1 Database
    // Ensure source exists
    await env.DB.prepare('INSERT OR IGNORE INTO sources (name, url, type) VALUES (?, ?, ?)')
      .bind(article.source, `source://${article.source}`, 'rss')
      .run();

    const sourceRecord = await env.DB.prepare('SELECT id FROM sources WHERE name = ?')
      .bind(article.source)
      .first<{ id: number }>();

    // Insert article
    const articleInsert = await env.DB.prepare(
      'INSERT INTO articles (source_id, title, url, content_snippet, published_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(sourceRecord?.id || 1, article.title, article.url, article.snippet, article.publishedAt)
      .run();

    const articleId = articleInsert.meta.last_row_id;

    // Insert story
    await env.DB.prepare(`
      INSERT INTO stories (
        id, title, persian_title, persian_summary, why_it_matters, youtube_angle,
        controversy_details, verified_reactions, primary_category,
        importance_score, relevance_score, combined_score, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alerted')
    `)
      .bind(
        storyId,
        article.title,
        aiResult.persian_title,
        aiResult.persian_summary,
        aiResult.why_it_matters,
        aiResult.youtube_angle,
        aiResult.controversy_details,
        aiResult.verified_reactions,
        aiResult.primary_category,
        aiResult.importance_score,
        aiResult.relevance_score,
        combinedScore
      )
      .run();

    // Map story to article
    await env.DB.prepare('INSERT INTO story_articles (story_id, article_id) VALUES (?, ?)')
      .bind(storyId, articleId)
      .run();

    const story: Story = {
      id: storyId,
      title: article.title,
      persian_title: aiResult.persian_title,
      persian_summary: aiResult.persian_summary,
      why_it_matters: aiResult.why_it_matters,
      youtube_angle: aiResult.youtube_angle,
      controversy_details: aiResult.controversy_details,
      verified_reactions: aiResult.verified_reactions,
      confidence_level: 'high',
      importance_score: aiResult.importance_score,
      relevance_score: aiResult.relevance_score,
      combined_score: combinedScore,
      status: 'alerted',
      primary_category: aiResult.primary_category,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 5. Send interactive card to Telegram channel/group
    const targetChatId = (env.TELEGRAM_CHANNEL_ID || '').trim();
    console.log(`[Pipeline] Delivering story card to Telegram chat: ${targetChatId}`);
    
    await sendStoryCard(bot, targetChatId, undefined, story);

    processedStories.push(story);
  }

  // 6. Record job execution
  await env.DB.prepare(
    "INSERT INTO job_executions (job_type, status, summary, finished_at) VALUES (?, 'completed', ?, datetime('now'))"
  )
    .bind('pipeline_single_test', `Processed ${processedStories.length} stories`)
    .run();

  return processedStories;
}
