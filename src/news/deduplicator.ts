import { FetchedArticle } from './fetcher';

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

function tokenize(text: string): Set<string> {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(clean);
}

function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'about', 'after', 'will', 'have',
  'new', 'how', 'why', 'what', 'its', 'their', 'more', 'into', 'over', 'says', 'said',
  'just', 'than', 'could', 'should', 'would', 'first', 'report', 'reports', 'here',
]);
