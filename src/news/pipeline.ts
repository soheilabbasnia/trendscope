import { Env, Story } from '../types';
import { fetchTopTechNews } from './fetcher';
import { clusterArticles } from './deduplicator';
import { analyzeNewsWithGemini } from '../ai/gemini';
import { calculateStoryScore } from './ranker';
import { TelegramBot } from '../telegram/bot';
import { sendStoryCard } from '../telegram/handlers';

export async function runNewsPipeline(
  env: Env,
  limit: number = 5,
  minImportanceScore: number = 6.0
): Promise<Story[]> {
  console.log(`[Pipeline] Running news pipeline (limit: ${limit}, minScore: ${minImportanceScore})`);
  const bot = new TelegramBot((env.TELEGRAM_BOT_TOKEN || '').trim());
  const processedStories: Story[] = [];

  // 1. Fetch fresh pool of tech news
  const rawArticles = await fetchTopTechNews(6);
  console.log(`[Pipeline] Fetched ${rawArticles.length} raw articles from feeds.`);

  // 2. Cluster related stories & deduplicate
  const clusters = clusterArticles(rawArticles);
  console.log(`[Pipeline] Clustered into ${clusters.length} unique stories.`);

  for (const cluster of clusters) {
    if (processedStories.length >= limit) break;

    const article = cluster.primaryArticle;

    // Check if this article URL already exists in database
    const existing = await env.DB.prepare('SELECT id FROM articles WHERE url = ?')
      .bind(article.url)
      .first<{ id: number }>();

    if (existing) {
      continue;
    }

    try {
      // 3. AI Analysis with Gemini
      console.log(`[Pipeline] Analyzing story: "${article.title}"`);
      const aiResult = await analyzeNewsWithGemini(article, env.GEMINI_API_KEY);

      // Extract entities (e.g. OpenAI, Nvidia, Google, Apple) from text
      const entities = extractEntities(article.title + ' ' + (aiResult.persian_title || ''));

      // 4. Calculate adaptive taste & ranking score
      const scores = await calculateStoryScore(
        env.DB,
        aiResult.primary_category,
        entities,
        aiResult.importance_score,
        aiResult.relevance_score
      );

      // Filter by minimum importance score
      if (scores.combinedScore < minImportanceScore && processedStories.length > 0) {
        console.log(`[Pipeline] Skipping story due to low score: ${scores.combinedScore} < ${minImportanceScore}`);
        continue;
      }

      const storyId = crypto.randomUUID();

      // 5. Store source & article in D1
      await env.DB.prepare('INSERT OR IGNORE INTO sources (name, url, type) VALUES (?, ?, ?)')
        .bind(article.source, `source://${article.source}`, 'rss')
        .run();

      const sourceRecord = await env.DB.prepare('SELECT id FROM sources WHERE name = ?')
        .bind(article.source)
        .first<{ id: number }>();

      const articleInsert = await env.DB.prepare(
        'INSERT INTO articles (source_id, title, url, content_snippet, published_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(sourceRecord?.id || 1, article.title, article.url, article.snippet, article.publishedAt)
        .run();

      const articleId = articleInsert.meta.last_row_id;

      // 6. Insert Story
      await env.DB.prepare(`
        INSERT INTO stories (
          id, title, persian_title, persian_summary, why_it_matters, youtube_angle,
          controversy_details, verified_reactions, primary_category, entities,
          importance_score, relevance_score, combined_score, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alerted')
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
          JSON.stringify(entities),
          scores.importanceScore,
          scores.relevanceScore,
          scores.combinedScore
        )
        .run();

      // 7. Associate primary and supporting articles
      await env.DB.prepare('INSERT INTO story_articles (story_id, article_id) VALUES (?, ?)')
        .bind(storyId, articleId)
        .run();

      for (const sup of cluster.supportingArticles) {
        const supInsert = await env.DB.prepare(
          'INSERT OR IGNORE INTO articles (source_id, title, url, content_snippet, published_at) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(sourceRecord?.id || 1, sup.title, sup.url, sup.snippet, sup.publishedAt)
          .run();
        if (supInsert.meta.last_row_id) {
          await env.DB.prepare('INSERT OR IGNORE INTO story_articles (story_id, article_id) VALUES (?, ?)')
            .bind(storyId, supInsert.meta.last_row_id)
            .run();
        }
      }

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
        importance_score: scores.importanceScore,
        relevance_score: scores.relevanceScore,
        combined_score: scores.combinedScore,
        status: 'alerted',
        primary_category: aiResult.primary_category,
        entities: JSON.stringify(entities),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // 8. Deliver to Telegram
      const targetChatId = (env.TELEGRAM_CHANNEL_ID || '').trim();
      await sendStoryCard(bot, targetChatId, undefined, story);

      processedStories.push(story);
    } catch (err: any) {
      console.error(`[Pipeline] Failed to analyze story "${article.title}":`, err.message);
    }
  }

  // 9. Log execution
  await env.DB.prepare(
    "INSERT INTO job_executions (job_type, status, summary, finished_at) VALUES (?, 'completed', ?, datetime('now'))"
  )
    .bind('news_pipeline', `Processed ${processedStories.length} stories`)
    .run();

  return processedStories;
}

function extractEntities(text: string): string[] {
  const commonEntities = [
    'OpenAI', 'Google', 'Microsoft', 'Apple', 'Meta', 'Nvidia', 'Amazon',
    'Anthropic', 'Tesla', 'Intel', 'AMD', 'Linux', 'Samsung', 'DeepSeek',
    'Elon Musk', 'Sam Altman', 'Jensen Huang', 'Sundar Pichai', 'Satya Nadella', 'Mark Zuckerberg'
  ];

  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const entity of commonEntities) {
    if (lower.includes(entity.toLowerCase())) {
      found.push(entity);
    }
  }
  return found;
}
