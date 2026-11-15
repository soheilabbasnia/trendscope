import { FetchedArticle } from '../news/fetcher';

export interface AIAnalysisResult {
  is_technology_or_computing: boolean;
  exclusion_reason: string | null;
  persian_title: string;
  persian_summary: string;
  primary_category: string;
  importance_score: number;
  relevance_score: number;
}

export async function analyzeNewsWithGemini(
  article: FetchedArticle,
  apiKey: string,
  modelName: string = 'gemini-3.5-flash-lite'
): Promise<AIAnalysisResult> {
  const prompt = `
You are a senior tech news editor for a technology YouTube channel.
TrendScope focuses EXCLUSIVELY on technology and computing-related news.

ALLOWED TOPICS:
- Artificial Intelligence, AI Models, AI Research, LLMs
- Computer Hardware, GPUs, CPUs, Semiconductors, Chips
- Software, Operating Systems, Programming, Developer Tools
- Cybersecurity, Privacy, Encryption, Hacks
- Cloud Computing, Data Centers, Networking
- Major Technology Companies (OpenAI, Google, Microsoft, Apple, Nvidia, Meta, Anthropic, Tesla tech, etc.)
- Technology Industry, Startups, and Tech Business Developments
- Computing-Related Product Announcements (phones, laptops, wearables)
- Controversies and Public Statements Involving Tech Companies and Tech Executives

EXCLUDED TOPICS (Must set "is_technology_or_computing": false):
- Astronomy and space discoveries unrelated to computing (e.g. telescopes finding ice/asteroids/exoplanets)
- General science discoveries (biology, medicine, paleontology, chemistry)
- Celebrity gossip unrelated to tech
- Sports
- Politics without a direct technology/computing connection
- Entertainment, movies, gaming lore without technology focus
- Automotive news unrelated to computing, autonomous driving, or AI
- General lifestyle content

Evaluate contextual relevance carefully.
Article to analyze:
Headline: ${article.title}
Source: ${article.source}
Published At: ${article.publishedAt}
Snippet: ${article.snippet}

Return ONLY valid JSON matching this schema:
{
  "is_technology_or_computing": true,
  "exclusion_reason": null,
  "persian_title": "تیتر دقیق و جذاب به زبان فارسی",
  "persian_summary": "خلاصه کاملاً روان، دقیق و حداکثر در ۲ الی ۳ خط درباره اصل رویداد.",
  "primary_category": "AI",
  "importance_score": 8.8,
  "relevance_score": 8.7
}

Note:
- The input article may be in English or Persian (from Persian tech publications like Zoomit, Digiato, etc.).
- If the article is already in Persian, refine the title into a crisp, professional Persian headline ("persian_title") and write a clear 2-3 line summary ("persian_summary").
- If excluded, set "is_technology_or_computing": false and explain in "exclusion_reason".
- Scores must be honest floats between 1.0 and 10.0 reflecting global tech significance.
`;

  const cleanApiKey = apiKey.trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${cleanApiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (HTTP ${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned an empty response.');
  }

  try {
    const parsed = JSON.parse(rawText) as AIAnalysisResult;
    return parsed;
  } catch (err: any) {
    throw new Error(`Failed to parse Gemini JSON output: ${err.message}. Raw: ${rawText}`);
  }
}
