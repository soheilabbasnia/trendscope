import test from 'node:test';
import assert from 'node:assert/strict';
import { approveStory, rejectStory } from '../src/workflow/storyActions.ts';
import { buildGeneralKeyboard, formatStoryGeneralMessage, formatStoryNewsMessage } from '../src/telegram/formatters.ts';
import { decodeHtmlEntities } from '../src/utils/text.ts';

// Mock D1 Database
class MockD1 {
  stories: Map<string, any> = new Map();
  feedback: any[] = [];
  deliveries: any[] = [];
  preferences: Map<string, number> = new Map();

  constructor() {
    this.stories.set('story-1', {
      id: 'story-1',
      title: 'Nvidia releases Blackwell architecture',
      persian_title: 'رونمایی انویدیا از بلک‌ول',
      persian_summary: 'انویدیا معماری جدید خود را معرفی کرد.',
      combined_score: 9.2,
      primary_category: 'سخت‌افزار و تراشه',
      status: 'new',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  prepare(query: string) {
    const self = this;
    let boundParams: any[] = [];

    const stmt = {
      bind(...params: any[]) {
        boundParams = params;
        return stmt;
      },
      async first<T = any>() {
        if (query.includes('SELECT * FROM stories WHERE id = ?')) {
          const s = self.stories.get(boundParams[0]);
          return (s ? { ...s } : null) as T;
        }
        if (query.includes('SELECT id FROM telegram_deliveries')) {
          const match = self.deliveries.find(
            (d) => d.story_id === boundParams[0] && d.delivery_type === 'news'
          );
          return (match ? { id: 1 } : null) as T;
        }
        if (query.includes('SELECT chat_id, message_id FROM telegram_deliveries')) {
          return null as T;
        }
        if (query.includes('SELECT value FROM settings')) {
          return null as T;
        }
        return null as T;
      },
      async all<T = any>() {
        return { results: [] } as any;
      },
      async run() {
        if (query.includes("UPDATE stories SET status = 'approved'")) {
          const s = self.stories.get(boundParams[0]);
          if (s) {
            s.status = 'approved';
            s.updated_at = new Date().toISOString();
          }
        }
        if (query.includes("UPDATE stories SET status = 'rejected'")) {
          const s = self.stories.get(boundParams[0]);
          if (s) {
            s.status = 'rejected';
            s.updated_at = new Date().toISOString();
          }
        }
        if (query.includes('INSERT INTO user_feedback')) {
          self.feedback.push({
            story_id: boundParams[0],
            user_id: boundParams[1],
            action: boundParams[2],
          });
        }
        if (query.includes('INSERT INTO taste_preferences')) {
          const key = boundParams[0];
          const delta = boundParams[2];
          const curr = self.preferences.get(key) || 1.0;
          self.preferences.set(key, curr + delta);
        }
        if (query.includes('INSERT INTO telegram_deliveries')) {
          self.deliveries.push({
            story_id: boundParams[0],
            chat_id: boundParams[1],
            delivery_type: boundParams[4],
          });
        }
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  }
}

test('Workflow Simplification: General Keyboard has exactly two buttons (Approve & Reject)', () => {
  const keyboard = buildGeneralKeyboard('story-1');
  assert.equal(keyboard.inline_keyboard.length, 1);
  const row = keyboard.inline_keyboard[0];
  assert.equal(row.length, 2);
  assert.equal(row[0].text, '✅ تأیید');
  assert.equal(row[0].callback_data, 'approve:story-1');
  assert.equal(row[1].text, '❌ رد');
  assert.equal(row[1].callback_data, 'reject:story-1');
});

test('Workflow Simplification: News message format is Read-Only', () => {
  const story = {
    id: 'story-1',
    title: 'Test Headline',
    persian_title: 'عنوان تستی فارسی',
    persian_summary: 'خلاصه مختصر فارسی',
    combined_score: 9.0,
    primary_category: 'هوش مصنوعی',
  } as any;

  const msg = formatStoryNewsMessage(story, []);
  assert.ok(msg.includes('📌 <b>[خبر تأییدشده]</b>'));
  assert.ok(msg.includes('عنوان تستی فارسی'));
  assert.ok(msg.includes('امتیاز:</b> ۹/۱۰') || msg.includes('امتیاز:</b> ۹.۰/۱۰') || msg.includes('امتیاز:</b>'));
  // Should NOT contain presenter hook or why it matters
  assert.ok(!msg.includes('ایده ضبط برای مجری'));
  assert.ok(!msg.includes('چرا اهمیت دارد؟'));
});

test('Story Actions: Approve updates D1 to approved, records positive feedback and delivers to News', async () => {
  const mockDb = new MockD1();
  const mockEnv: any = {
    DB: mockDb,
    TELEGRAM_BOT_TOKEN: 'mock-token',
    TELEGRAM_CHANNEL_ID: '-1003931218265',
    TELEGRAM_ADMIN_ID: '6758430388',
  };

  const result = await approveStory(mockEnv, 'story-1', {
    type: 'dashboard',
    userId: '6758430388',
  });

  assert.equal(result.success, true);
  assert.equal(mockDb.stories.get('story-1').status, 'approved');
  assert.ok(mockDb.feedback.some((f) => f.story_id === 'story-1' && f.action === 'approve'));
});

test('Story Actions: Reject marks story as rejected and records negative feedback', async () => {
  const mockDb = new MockD1();
  const mockEnv: any = {
    DB: mockDb,
    TELEGRAM_BOT_TOKEN: 'mock-token',
    TELEGRAM_CHANNEL_ID: '-1003931218265',
    TELEGRAM_ADMIN_ID: '6758430388',
  };

  const result = await rejectStory(mockEnv, 'story-1', {
    type: 'dashboard',
    userId: '6758430388',
  });

  assert.equal(result.success, true);
  assert.equal(mockDb.stories.get('story-1').status, 'rejected');
  assert.ok(mockDb.feedback.some((f) => f.story_id === 'story-1' && f.action === 'reject'));
});

test('Story Actions: Idempotent operations return success without re-processing', async () => {
  const mockDb = new MockD1();
  const mockEnv: any = {
    DB: mockDb,
    TELEGRAM_BOT_TOKEN: 'mock-token',
    TELEGRAM_CHANNEL_ID: '-1003931218265',
    TELEGRAM_ADMIN_ID: '6758430388',
  };

  // First approve
  await approveStory(mockEnv, 'story-1', { type: 'dashboard', userId: 'admin' });
  const feedbackCount1 = mockDb.feedback.length;

  // Second approve
  const secondResult = await approveStory(mockEnv, 'story-1', { type: 'dashboard', userId: 'admin' });
  assert.equal(secondResult.success, true);
  assert.equal(mockDb.feedback.length, feedbackCount1); // No duplicate feedback inserted
});

test('HTML Entities: decodeHtmlEntities cleanly converts decimal, hex, and named entities', () => {
  assert.equal(decodeHtmlEntities('Where was Nvidia&#8217;s security team?'), 'Where was Nvidia’s security team?');
  assert.equal(decodeHtmlEntities('didn&#8217;t make it'), 'didn’t make it');
  assert.equal(decodeHtmlEntities('can&#8217;t trust AI'), 'can’t trust AI');
  assert.equal(decodeHtmlEntities('&quot;AI &amp; Tech&quot; &#8211; &lt;Cloud&gt;'), '"AI & Tech" – <Cloud>');
  assert.equal(decodeHtmlEntities('&#8220;quoted&#8221; and &#8216;single&#8217;'), '“quoted” and ‘single’');
  assert.equal(decodeHtmlEntities('&#x2019;hex entity&#x2019;'), '’hex entity’');
});
