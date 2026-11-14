-- TrendScope D1 Database Schema
-- Version: 0.1.0

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'rss',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER REFERENCES sources(id),
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    content_snippet TEXT,
    published_at TEXT,
    guid TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    persian_title TEXT,
    persian_summary TEXT,
    why_it_matters TEXT,
    youtube_angle TEXT,
    controversy_details TEXT,
    verified_reactions TEXT,
    confidence_level TEXT DEFAULT 'medium',
    importance_score REAL DEFAULT 0,
    relevance_score REAL DEFAULT 0,
    combined_score REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new', -- 'new', 'alerted', 'saved', 'rejected', 'selected', 'covered'
    rejection_reason TEXT,
    primary_category TEXT,
    entities TEXT, -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS story_articles (
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, article_id)
);

CREATE TABLE IF NOT EXISTS story_social_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episode_stories (
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    rank_order INTEGER NOT NULL DEFAULT 0,
    is_selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (episode_id, story_id)
);

CREATE TABLE IF NOT EXISTS telegram_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id TEXT REFERENCES stories(id),
    episode_id INTEGER REFERENCES episodes(id),
    chat_id TEXT NOT NULL,
    message_thread_id INTEGER,
    message_id INTEGER NOT NULL,
    delivery_type TEXT NOT NULL,
    delivered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taste_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_type TEXT NOT NULL,
    key_name TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (key_type, key_name)
);

CREATE TABLE IF NOT EXISTS user_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id TEXT NOT NULL REFERENCES stories(id),
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
('project_name', 'TrendScope'),
('auto_publish_threshold', '7.0'),
('max_stories_per_cycle', '5'),
('timezone', 'Asia/Tehran');
