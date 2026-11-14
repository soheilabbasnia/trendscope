// TrendScope TypeScript Definitions

export interface Env {
  DB: D1Database;
  PROJECT_NAME: string;
  TIMEZONE: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHANNEL_ID: string;
  TELEGRAM_ADMIN_ID: string;
  GEMINI_API_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  is_forum?: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  message_thread_id?: number;
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  channel_post?: TelegramMessage;
}

export interface Story {
  id: string;
  title: string;
  persian_title: string | null;
  persian_summary: string | null;
  why_it_matters: string | null;
  youtube_angle: string | null;
  controversy_details: string | null;
  verified_reactions: string | null;
  confidence_level: string;
  importance_score: number;
  relevance_score: number;
  combined_score: number;
  status: 'new' | 'alerted' | 'saved' | 'rejected' | 'selected' | 'covered';
  rejection_reason?: string | null;
  primary_category?: string | null;
  entities?: string | null;
  created_at: string;
  updated_at: string;
}
