import { decodeHtmlEntities } from '../utils/text';

export interface FetchedArticle {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string;
  source: string;
}

const TECH_FEEDS = [
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'Ars Technica', url: 'https://arstechnica.com/feed/' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Wired Gear', url: 'https://www.wired.com/feed/category/gear/latest/rss' },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
];

export async function fetchTopTechNews(maxPerFeed: number = 6): Promise<FetchedArticle[]> {
  const allArticles: FetchedArticle[] = [];

  for (const feed of TECH_FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
      });

      if (!response.ok) {
        console.warn(`[Fetcher] Feed ${feed.name} returned HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const parsed = parseRssOrAtom(xml, feed.name, maxPerFeed);
      allArticles.push(...parsed);
    } catch (err: any) {
      console.error(`[Fetcher] Failed to fetch feed ${feed.name}:`, err.message);
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

    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/i) || itemXml.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i);
    const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const title = cleanXmlText(titleMatch ? titleMatch[1] : '');
    const url = cleanXmlText(linkMatch ? linkMatch[1] : '');
    let snippet = cleanXmlText(descMatch ? descMatch[1] : '').replace(/<[^>]+>/g, '').trim();

    if (title && url) {
      items.push({
        title,
        url,
        snippet: snippet.slice(0, 500),
        publishedAt: pubDateMatch ? pubDateMatch[1] : new Date().toISOString(),
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
      const pubDateMatch = entryXml.match(/<published>([\s\S]*?)<\/published>/i) || entryXml.match(/<updated>([\s\S]*?)<\/updated>/i);

      const title = cleanXmlText(titleMatch ? titleMatch[1] : '');
      const url = cleanXmlText(linkMatch ? linkMatch[1] : '');
      let snippet = cleanXmlText(summaryMatch ? summaryMatch[1] : '').replace(/<[^>]+>/g, '').trim();

      if (title && url) {
        items.push({
          title,
          url,
          snippet: snippet.slice(0, 500),
          publishedAt: pubDateMatch ? pubDateMatch[1] : new Date().toISOString(),
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
