import type { InlineKeyboardMarkup } from '../types.ts';

export class TelegramBot {
  private token: string;
  private baseUrl: string;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(params: {
    chat_id: number | string;
    text: string;
    parse_mode?: 'HTML' | 'MarkdownV2';
    message_thread_id?: number;
    reply_markup?: InlineKeyboardMarkup;
    disable_web_page_preview?: boolean;
  }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        parse_mode: params.parse_mode ?? 'HTML',
        disable_web_page_preview: params.disable_web_page_preview ?? true,
      }),
    });
    return await res.json();
  }

  async editMessageText(params: {
    chat_id: number | string;
    message_id: number;
    text: string;
    parse_mode?: 'HTML' | 'MarkdownV2';
    reply_markup?: InlineKeyboardMarkup;
    disable_web_page_preview?: boolean;
  }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        parse_mode: params.parse_mode ?? 'HTML',
        disable_web_page_preview: params.disable_web_page_preview ?? true,
      }),
    });
    return await res.json();
  }

  async answerCallbackQuery(params: {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
  }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  }

  async deleteMessage(params: { chat_id: number | string; message_id: number }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  }

  async setWebhook(url: string, secretToken: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query', 'channel_post'],
        drop_pending_updates: true,
      }),
    });
    return await res.json();
  }

  async getWebhookInfo(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/getWebhookInfo`);
    return await res.json();
  }
}
