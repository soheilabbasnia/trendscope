import { decodeHtmlEntities } from '../utils/text.ts';

export interface FetchedArticle {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string;
  source: string;
}

export interface TechFeed {
  name: string;
  url: string;
  lang: 'fa' | 'en';
}

export const TECH_FEEDS: TechFeed[] = [
  // Persian Technology Sources (منابع خبری معتبر فناوری ایران)
  { name: 'زومیت', url: 'https://www.zoomit.ir/feed/', lang: 'fa' },
  { name: 'دیجیاتو', url: 'https://digiato.com/feed', lang: 'fa' },
  { name: 'دیجیاتو AI', url: 'https://digiato.com/topic/artificial-intelligence/feed', lang: 'fa' },
  { name: 'ترنجی', url: 'https://toranji.ir/feed/', lang: 'fa' },
  { name: 'فارنت', url: 'https://farnet.io/feed/', lang: 'fa' },
  { name: 'آی‌تی ایران', url: 'https://itiran.com/feed/', lang: 'fa' },
  { name: 'هوشیو', url: 'https://hooshio.com/feed/', lang: 'fa' },
  { name: 'گجت نیوز', url: 'https://gadgetnews.net/category/gadgets/feed/', lang: 'fa' },
  { name: 'ایستنا', url: 'https://ictna.ir/feed/', lang: 'fa' },

  // International Tech Sources (منابع برتر فناوری بین‌المللی)
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', lang: 'en' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en' },
  { name: 'Ars Technica', url: 'https://arstechnica.com/feed/', lang: 'en' },
  { name: 'Wired', url: 'https://www.wired.com/feed/category/gear/latest/rss', lang: 'en' },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', lang: 'en' },
];

export async function fetchTopTechNews(maxPerFeed: number = 6): Promise<FetchedArticle[]> {
  const feedPromises = TECH_FEEDS.map(async (feed) => {
    try {
      const response = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!response.ok) {
        console.warn(`[Fetcher] Feed ${feed.name} returned HTTP ${response.status}`);
        return [];
      }

      const xml = await response.text();
      return parseRssOrAtom(xml, feed.name, maxPerFeed);
    } catch (err: any) {
      console.error(`[Fetcher] Failed to fetch feed ${feed.name}:`, err.message);
      return [];
    }
  });

  const results = await Promise.allSettled(feedPromises);
  const allArticles: FetchedArticle[] = [];

  for (const res of results) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allArticles.push(...res.value);
    }
  }

  return allArticles;
}

function parseRssOrAtom(xml: string, sourceName: string, maxItems: number): FetchedArticle[] {
  const items: FetchedArticle[] = [];

  // 1. Try RSS <item>
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const itemXml of itemMatches) {
    if (items.length >= maxItems) break;

    const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || itemXml.match(/<link[^>]*href="([^"]+)"/i);
    const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || itemXml.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
    const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

    const title = cleanXmlText(titleMatch ? titleMatch[1] : '').trim();
    const url = cleanXmlText(linkMatch ? (linkMatch[1] || linkMatch[0]) : '').trim();
    let snippet = cleanXmlText(descMatch ? descMatch[1] : '').replace(/<[^>]+>/g, '').trim();

    if (title && url) {
      items.push({
        title,
        url,
        snippet: snippet.slice(0, 500),
        publishedAt: pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString(),
        source: sourceName,
      });
    }
  }

  // 2. Try Atom <entry>
  if (items.length === 0) {
    const entryMatches = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    for (const entryXml of entryMatches) {
      if (items.length >= maxItems) break;

      const titleMatch = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const linkMatch = entryXml.match(/<link[^>]*href="([^"]+)"/i) || entryXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      const summaryMatch = entryXml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
      const pubDateMatch = entryXml.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || entryXml.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);

      const title = cleanXmlText(titleMatch ? titleMatch[1] : '').trim();
      const url = cleanXmlText(linkMatch ? (linkMatch[1] || linkMatch[0]) : '').trim();
      let snippet = cleanXmlText(summaryMatch ? summaryMatch[1] : '').replace(/<[^>]+>/g, '').trim();

      if (title && url) {
        items.push({
          title,
          url,
          snippet: snippet.slice(0, 500),
          publishedAt: pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString(),
          source: sourceName,
        });
      }
    }
  }

  return items;
}

function cleanXmlText(text: string): string {
  return decodeHtmlEntities(text);
}
