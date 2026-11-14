import { FetchedArticle } from '../news/fetcher';

export interface AIAnalysisResult {
  persian_title: string;
  persian_summary: string;
  why_it_matters: string;
  youtube_angle: string;
  controversy_details: string;
  verified_reactions: string;
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
You are a senior tech news editor and YouTube technology show producer for a top Persian-language tech channel.
Analyze the following global tech news article:

Headline: ${article.title}
Source: ${article.source}
Published At: ${article.publishedAt}
Snippet: ${article.snippet}

Produce a structured Persian intelligence briefing for a YouTube video presenter.
Return ONLY valid JSON matching this schema:
{
  "persian_title": "عنوان جذاب، دقیق و تیتریک به زبان فارسی بدون مبالغه دروغین",
  "persian_summary": "خلاصه کاملاً روان، فارسی و خوانا در ۲ الی ۳ جمله درباره اصل اتفاق",
  "why_it_matters": "چرا این خبر اهمیت استراتژیک دارد و در صنعت فناوری تاثیرگذار است؟",
  "youtube_angle": "زاویه جذاب برای صحبت مجری در یوتیوب (Hook، سوال چالشی از مخاطب یا تحلیل عمیق)",
  "controversy_details": "هرگونه حاشیه، انتقاد، بازخورد کاربران یا رقبا (در صورت نبود بنویسید: بدون حاشیه خاص)",
  "verified_reactions": "واکنش یا نقل قول افراد کلیدی یا رقبا (در صورت نبود بنویسید: بدون واکنش رسمی)",
  "primary_category": "AI, Hardware, Software, Mobile, BigTech, Security, etc.",
  "importance_score": 8.5,
  "relevance_score": 9.0
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
