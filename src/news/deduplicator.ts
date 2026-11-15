import type { FetchedArticle } from './fetcher.ts';

export interface ClusteredStoryCandidate {
  primaryArticle: FetchedArticle;
  supportingArticles: FetchedArticle[];
}

export function clusterArticles(articles: FetchedArticle[]): ClusteredStoryCandidate[] {
  const clusters: ClusteredStoryCandidate[] = [];

  for (const article of articles) {
    const articleTokens = tokenize(article.title);
    let matchedCluster: ClusteredStoryCandidate | null = null;

    for (const cluster of clusters) {
      const clusterTokens = tokenize(cluster.primaryArticle.title);
      const similarity = computeJaccardSimilarity(articleTokens, clusterTokens);

      // If token similarity is >= 0.45 or both have the same core entity & action keywords
      if (similarity >= 0.45) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.supportingArticles.push(article);
    } else {
      clusters.push({
        primaryArticle: article,
        supportingArticles: [],
      });
    }
  }

  return clusters;
}

export function normalizePersian(str: string): string {
  return str
    .replace(/\u200c/g, ' ')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[\u064B-\u065F]/g, '');
}

export function tokenize(text: string): Set<string> {
  const normalized = normalizePersian(text.toLowerCase());
  const clean = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(clean);
}

export function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const STOP_WORDS = new Set([
  // English stop words
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'about', 'after', 'will', 'have',
  'new', 'how', 'why', 'what', 'its', 'their', 'more', 'into', 'over', 'says', 'said',
  'just', 'than', 'could', 'should', 'would', 'first', 'report', 'reports', 'here',
  // Persian stop words
  'این', 'برای', 'است', 'های', 'شد', 'شدن', 'کرد', 'کردن', 'یک', 'به', 'با',
  'از', 'که', 'در', 'آن', 'تا', 'را', 'بر', 'روی', 'باید', 'می', 'کند',
  'شود', 'دارد', 'دارند', 'بود', 'بوده', 'پس', 'اما', 'اگر', 'چرا', 'چگونه',
  'خود', 'بخش', 'دیگر', 'بسیار', 'میان', 'ویژه'
]);
