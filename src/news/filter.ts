// TrendScope v0.1.2 — Strict Technology News Filter & Score Validator

export const MIN_QUALIFYING_SCORE = 8.5;

export interface TechRelevanceEvaluation {
  isEligible: boolean;
  category: string;
  reason: string;
}

export const ALLOWED_TECH_CATEGORIES = new Set([
  'artificial intelligence',
  'ai',
  'ai research',
  'ai models',
  'computer hardware',
  'hardware',
  'gpus',
  'cpus',
  'semiconductors',
  'chips',
  'software',
  'operating systems',
  'programming',
  'developer tools',
  'cybersecurity',
  'security',
  'cloud computing',
  'cloud',
  'data centers',
  'major technology companies',
  'bigtech',
  'tech industry',
  'computing products',
  'tech business',
  'controversy',
]);

const STRICT_EXCLUSION_KEYWORDS = [
  'james webb',
  'telescope',
  'ancient ice',
  'astronomy',
  'asteroid',
  'black hole',
  'galaxy',
  'meteorite',
  'space telescope',
  'exoplanet',
  'supernova',
  'dinosaur',
  'fossil',
  'paleontology',
  'archaeology',
  'wildlife',
  'biology',
  'cancer treatment',
  'vaccine',
  'clinical trial',
  'celebrity divorce',
  'box office',
  'hollywood',
  'grammy',
  'oscar',
  'olympics',
  'premier league',
  'world cup',
  'nfl',
  'nba',
];

export function isQualifyingScore(score: number): boolean {
  // STRICTLY GREATER than 8.5 (never round upward)
  // 8.4 -> false, 8.5 -> false, 8.51 -> true, 8.6 -> true
  if (typeof score !== 'number' || isNaN(score)) {
    return false;
  }
  return score > MIN_QUALIFYING_SCORE;
}

export function evaluateTechnologyRelevance(
  aiVerdict: {
    is_technology_or_computing?: boolean;
    primary_category?: string;
    exclusion_reason?: string | null;
  },
  title: string,
  snippet: string
): TechRelevanceEvaluation {
  const lowerTitle = (title || '').toLowerCase();
  const lowerSnippet = (snippet || '').toLowerCase();
  const lowerCat = (aiVerdict.primary_category || '').toLowerCase().trim();

  // 1. Explicit AI verdict check
  if (aiVerdict.is_technology_or_computing === false) {
    return {
      isEligible: false,
      category: aiVerdict.primary_category || 'Excluded',
      reason: aiVerdict.exclusion_reason || 'AI evaluated this story as non-technology/non-computing.',
    };
  }

  // 2. Non-tech category check
  if (
    lowerCat.includes('astronomy') ||
    lowerCat.includes('space discovery') ||
    lowerCat.includes('biology') ||
    lowerCat.includes('health') ||
    lowerCat.includes('sports') ||
    lowerCat.includes('entertainment') ||
    lowerCat.includes('general science') ||
    lowerCat.includes('lifestyle')
  ) {
    // Unless it explicitly involves computing/AI/hardware
    const hasComputingFocus =
      lowerTitle.includes('ai') ||
      lowerTitle.includes('computing') ||
      lowerTitle.includes('chip') ||
      lowerTitle.includes('software');

    if (!hasComputingFocus) {
      return {
        isEligible: false,
        category: aiVerdict.primary_category || 'Non-Tech Science',
        reason: `Category '${aiVerdict.primary_category}' is excluded from tech intelligence focus.`,
      };
    }
  }

  // 3. Contextual exclusion check for pure science/astronomy without computing
  for (const keyword of STRICT_EXCLUSION_KEYWORDS) {
    if (lowerTitle.includes(keyword) || lowerSnippet.includes(keyword)) {
      // Allow only if computing or semiconductors is the primary subject
      const isComputingSubject =
        lowerTitle.includes('supercomputer') ||
        lowerTitle.includes('quantum computer') ||
        lowerTitle.includes('ai model') ||
        lowerTitle.includes('semiconductor') ||
        lowerTitle.includes('chip');

      if (!isComputingSubject) {
        return {
          isEligible: false,
          category: 'Excluded Topic',
          reason: `Topic involves '${keyword}' without primary computing/technology focus.`,
        };
      }
    }
  }

  return {
    isEligible: true,
    category: aiVerdict.primary_category || 'Tech',
    reason: 'Qualifies under computing and technology scope.',
  };
}
