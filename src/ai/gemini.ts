import { FetchedArticle } from '../news/fetcher';

export interface AIAnalysisResult {
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
Analyze the following tech news article:

Headline: ${article.title}
Source: ${article.source}
Published At: ${article.publishedAt}
Snippet: ${article.snippet}

Produce a concise, factual Persian briefing.
Requirements:
1. "persian_title": Accurate, compelling Persian headline (no fake clickbait).
2. "persian_summary": Concise Persian summary in MAXIMUM 2-3 lines explaining the core factual development.
3. "primary_category": One main category (e.g. AI, Hardware, Software, Mobile, BigTech, Security, Cloud, Chips).
4. "importance_score": Global tech industry significance (1.0 to 10.0).
5. "relevance_score": Creator channel interest and audience engagement (1.0 to 10.0).

Return ONLY valid JSON matching this schema:
{
  "persian_title": "تیتر دقیق و جذاب به زبان فارسی",
  "persian_summary": "خلاصه کاملاً روان، دقیق و حداکثر در ۲ الی ۳ خط درباره اصل رویداد.",
  "primary_category": "AI",
  "importance_score": 8.5,
  "relevance_score": 8.0
}
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
