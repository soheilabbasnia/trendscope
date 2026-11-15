export interface StoryScore {
  importanceScore: number;
  relevanceScore: number;
  combinedScore: number;
}

export async function calculateStoryScore(
  db: D1Database,
  category: string,
  entities: string[],
  baseImportance: number,
  baseRelevance: number
): Promise<StoryScore> {
  let preferenceMultiplier = 1.0;

  try {
    // 1. Check category preference weight
    const catPref = await db
      .prepare("SELECT weight FROM taste_preferences WHERE key_type = 'category' AND key_name = ?")
      .bind(category)
      .first<{ weight: number }>();

    if (catPref) {
      preferenceMultiplier *= catPref.weight;
    }

    // 2. Check entity weights
    for (const entity of entities) {
      const entPref = await db
        .prepare("SELECT weight FROM taste_preferences WHERE key_type = 'entity' AND key_name = ?")
        .bind(entity)
        .first<{ weight: number }>();

      if (entPref) {
        preferenceMultiplier *= entPref.weight;
      }
    }
  } catch (err) {
    console.warn('[Ranker] Failed to query taste preferences:', err);
  }

  // Bound multiplier between 0.5 and 1.5 to prevent extreme drift
  const clampedMultiplier = Math.max(0.5, Math.min(1.5, preferenceMultiplier));

  // Calculated scores
  const adjustedRelevance = Math.min(10, Math.max(1, baseRelevance * clampedMultiplier));
  // 55% global importance, 45% channel taste relevance
  const combined = Number(((baseImportance * 0.55) + (adjustedRelevance * 0.45)).toFixed(2));

  return {
    importanceScore: baseImportance,
    relevanceScore: Number(adjustedRelevance.toFixed(2)),
    combinedScore: combined,
  };
}

export async function updateTastePreference(
  db: D1Database,
  category: string,
  entities: string[],
  action: 'select' | 'save' | 'reject' | 'cover' | 'approve'
): Promise<void> {
  const delta = (action === 'select' || action === 'approve') ? 0.2 : action === 'save' ? 0.1 : action === 'cover' ? 0.15 : -0.2;

  try {
    // Update category
    if (category) {
      await db.prepare(`
        INSERT INTO taste_preferences (key_type, key_name, weight, updated_at)
        VALUES ('category', ?, ?, datetime('now'))
        ON CONFLICT(key_type, key_name) DO UPDATE SET
          weight = MAX(0.5, MIN(2.0, weight + ?)),
          updated_at = datetime('now')
      `).bind(category, 1.0 + delta, delta).run();
    }

    // Update entities
    for (const entity of entities) {
      await db.prepare(`
        INSERT INTO taste_preferences (key_type, key_name, weight, updated_at)
        VALUES ('entity', ?, ?, datetime('now'))
        ON CONFLICT(key_type, key_name) DO UPDATE SET
          weight = MAX(0.5, MIN(2.0, weight + ?)),
          updated_at = datetime('now')
      `).bind(entity, 1.0 + delta, delta).run();
    }
  } catch (err) {
    console.error('[Ranker] Failed to update taste preferences:', err);
  }
}
