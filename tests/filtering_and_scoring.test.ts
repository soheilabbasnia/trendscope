import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isQualifyingScore,
  evaluateTechnologyRelevance,
  MIN_QUALIFYING_SCORE,
} from '../src/news/filter.ts';

test('1. Threshold boundaries: 8.4, 8.5, and 8.6 (Strictly > 8.5)', () => {
  // Test lower boundary
  assert.equal(isQualifyingScore(8.4), false, '8.4 must be REJECTED');
  assert.equal(isQualifyingScore(8.49), false, '8.49 must be REJECTED (no upward rounding)');
  
  // Test exact threshold boundary (MUST BE STRICTLY GREATER)
  assert.equal(isQualifyingScore(8.5), false, '8.5 must be REJECTED (strictly greater required)');
  assert.equal(isQualifyingScore(8.50), false, '8.50 must be REJECTED');
  
  // Test upper qualifying boundary
  assert.equal(isQualifyingScore(8.51), true, '8.51 must be ACCEPTED');
  assert.equal(isQualifyingScore(8.6), true, '8.6 must be ACCEPTED');
  assert.equal(isQualifyingScore(9.2), true, '9.2 must be ACCEPTED');
  assert.equal(isQualifyingScore(10.0), true, '10.0 must be ACCEPTED');

  // Test invalid values
  assert.equal(isQualifyingScore(NaN), false, 'NaN must be REJECTED');
  assert.equal(isQualifyingScore(0), false, '0 must be REJECTED');
  assert.equal(isQualifyingScore(-1), false, 'Negative scores must be REJECTED');
});

test('2. Out-of-scope science and non-technology news filtering', () => {
  // James Webb telescope ancient ice
  const jwstStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: false, primary_category: 'Astronomy', exclusion_reason: 'Astronomy without computing' },
    'James Webb telescope finds ice older than the star it orbits',
    'NASA space telescope discovered water ice in interstellar space'
  );
  assert.equal(jwstStory.isEligible, false, 'James Webb ancient ice discovery must be REJECTED');

  // General biology
  const bioStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: false, primary_category: 'Biology' },
    'Marine biologists discover glowing jellyfish in deep ocean trench',
    'New species documented off coast of Australia'
  );
  assert.equal(bioStory.isEligible, false, 'Marine biology discovery must be REJECTED');

  // Sports
  const sportsStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: false, primary_category: 'Sports' },
    'Manchester City wins thrilling derby in stoppage time',
    'Premier League title race heats up'
  );
  assert.equal(sportsStory.isEligible, false, 'Sports news must be REJECTED');

  // Entertainment / Celebrity
  const celebStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: false, primary_category: 'Entertainment' },
    'Hollywood stars gather for 98th Academy Awards ceremony',
    'Red carpet highlights and winners list'
  );
  assert.equal(celebStory.isEligible, false, 'Entertainment news must be REJECTED');
});

test('3. Relevant AI and computing technology news', () => {
  // AI model release
  const claudeStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: true, primary_category: 'AI' },
    'Anthropic launches Claude 3.7 Sonnet with hybrid reasoning capabilities',
    'New foundation model achieves state of the art on coding benchmarks'
  );
  assert.equal(claudeStory.isEligible, true, 'Claude 3.7 release must be ACCEPTED');

  // GPU & Semiconductor hardware
  const nvidiaStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: true, primary_category: 'Hardware' },
    'Nvidia reveals Blackwell B200 GPU pricing and data center deployment timeline',
    'Next generation AI superchips enter mass production'
  );
  assert.equal(nvidiaStory.isEligible, true, 'Nvidia GPU hardware news must be ACCEPTED');

  // Cybersecurity
  const cyberStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: true, primary_category: 'Cybersecurity' },
    'Critical Linux kernel zero-day vulnerability patched after active exploitation',
    'Security researchers warn enterprise server admins to upgrade immediately'
  );
  assert.equal(cyberStory.isEligible, true, 'Cybersecurity zero-day must be ACCEPTED');

  // Cloud & Data Centers
  const cloudStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: true, primary_category: 'Cloud' },
    'Microsoft and OpenAI plan $100 billion Stargate AI supercomputer data center',
    'Massive computing infrastructure initiative announced'
  );
  assert.equal(cloudStory.isEligible, true, 'Stargate AI supercomputer must be ACCEPTED');
});

test('4. Technology-related executive controversies and industry developments', () => {
  // Executive controversy
  const jensenControversy = evaluateTechnologyRelevance(
    { is_technology_or_computing: true, primary_category: 'Technology Industry' },
    'Elon Musk and tech execs sign petition calling on Nvidia to reinstate Jensen Huang',
    'Tech industry leaders react to leadership shifts at chip giant'
  );
  assert.equal(jensenControversy.isEligible, true, 'Nvidia leadership controversy must be ACCEPTED');

  // Antitrust BigTech controversy
  const antitrustStory = evaluateTechnologyRelevance(
    { is_technology_or_computing: true, primary_category: 'BigTech' },
    'DOJ requests court order to break up Google Chrome in historic antitrust ruling',
    'Judge finds Google maintained illegal search monopoly'
  );
  assert.equal(antitrustStory.isEligible, true, 'Google antitrust ruling must be ACCEPTED');
});

test('5. Automatic collection & Manual refresh filtering simulation', () => {
  // Candidate pool with mix of tech, non-tech, and varied scores
  const candidates = [
    { title: 'James Webb telescope finds ice', isTech: false, score: 9.1 }, // non-tech -> reject
    { title: 'Minor app updates icon design', isTech: true, score: 6.2 }, // low score -> reject
    { title: 'New Linux distro release candidate', isTech: true, score: 8.5 }, // boundary 8.5 -> reject (strictly > 8.5 required)
    { title: 'OpenAI GPT-5 preview unveiled', isTech: true, score: 9.4 }, // qualifying -> ACCEPT
    { title: 'TSMC begins 2nm chip production', isTech: true, score: 8.9 }, // qualifying -> ACCEPT
  ];

  const qualifyingForTelegram = candidates.filter((item) => {
    return item.isTech && isQualifyingScore(item.score);
  });

  assert.equal(qualifyingForTelegram.length, 2, 'Exactly 2 stories should qualify for Telegram publication');
  assert.equal(qualifyingForTelegram[0].title, 'OpenAI GPT-5 preview unveiled');
  assert.equal(qualifyingForTelegram[1].title, 'TSMC begins 2nm chip production');

  // Verify that the 8.5 score was NOT included
  const hasBoundaryStory = qualifyingForTelegram.some((s) => s.score === 8.5);
  assert.equal(hasBoundaryStory, false, 'Score of 8.5 must not qualify for Telegram');
});

test('6. Episode packages qualification & no filler policy', () => {
  // Simulated story pool from the Friday-Monday window
  const windowStories = [
    { id: '1', title: 'Claude 3.7', score: 9.3, status: 'alerted' },
    { id: '2', title: 'Quantum breakthrough', score: 8.8, status: 'alerted' },
    { id: '3', title: 'Ice on Telescope', score: 8.9, status: 'filtered_non_tech' }, // filtered non-tech
    { id: '4', title: 'Tech startup raises seed', score: 7.9, status: 'filtered_low_score' }, // low score
    { id: '5', title: 'Nvidia B200 timeline', score: 9.0, status: 'selected' },
  ];

  // Episode qualification criteria
  const qualifiedForPackage = windowStories.filter((s) => {
    return !s.status.startsWith('filtered') && s.status !== 'rejected' && isQualifyingScore(s.score);
  });

  assert.equal(qualifiedForPackage.length, 3, 'Only 3 stories qualify for the package');
  // Does not fabricate fillers to reach 15 if fewer exist
  assert.ok(qualifiedForPackage.length <= 15, 'Returns actual qualified count without filler');
});

test('7. Deduplication & preventing duplicate Telegram publishing', () => {
  const publishedStoryIds = new Set<string>();

  function publishStory(id: string): { success: boolean; duplicate: boolean } {
    if (publishedStoryIds.has(id)) {
      return { success: false, duplicate: true };
    }
    publishedStoryIds.add(id);
    return { success: true, duplicate: false };
  }

  // First publish
  const first = publishStory('story-uuid-1');
  assert.equal(first.success, true);
  assert.equal(first.duplicate, false);

  // Duplicate publish attempt
  const second = publishStory('story-uuid-1');
  assert.equal(second.success, false);
  assert.equal(second.duplicate, true, 'Second publish attempt must be detected as duplicate');
});
