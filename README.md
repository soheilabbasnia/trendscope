# TrendScope 📡🤖

> Telegram-first AI tech news intelligence platform powered by Cloudflare Workers, Cloudflare D1, and Google Gemini.

TrendScope is an automated news research and curation engine designed for technology content creators and YouTube channels. It continuously monitors global tech developments, filters high-signal stories, clusters coverage across multiple sources, produces Persian summaries and strategic YouTube angles using Gemini 2.5 Flash, and delivers interactive story packages directly to Telegram.

## 🚀 Key Features

- **Telegram-First Operation**: Real-time story alerts, interactive inline controls (Select for Recording, Save, Reject, Details), and recording package summaries.
- **Serverless & Zero-Cost Cloud Architecture**: Runs 100% on Cloudflare Workers edge network with Cloudflare D1 SQL database and zero monthly infrastructure cost.
- **AI Intelligence with Gemini 2.5 Flash**: Contextual Persian synthesis, fact extraction, why-it-matters analysis, and YouTube video angles.
- **Smart Story Clustering & Deduplication**: Multi-source aggregation turning fragmented articles into cohesive, trackable stories.
- **Bi-Weekly Recording Packages**: Automatic compilation every Monday and Friday at 07:00 Asia/Tehran for video recording prep.
- **Channel Taste Engine**: Adaptive scoring that learns from creator feedback and interaction history.

## 🛠 Tech Stack

- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/) (TypeScript)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQLite)
- **AI Engine**: [Google Gemini 2.5 Flash](https://ai.google.dev/)
- **Delivery**: Telegram Bot API (Webhooks)
- **Scheduler**: Cloudflare Cron Triggers

## 📁 Project Structure

```text
trendscope/
├── src/
│   ├── ai/            # Gemini API client & prompt engineering
│   ├── cron/          # Scheduled jobs & bi-weekly episode packages
│   ├── db/            # D1 database schema & query repositories
│   ├── news/          # RSS fetchers, normalizers & deduplication
│   ├── telegram/      # Telegram bot client, commands & interactive handlers
│   ├── config.ts      # App configuration
│   ├── index.ts       # Cloudflare Worker entrypoint
│   └── types.ts       # TypeScript schemas and data models
├── wrangler.jsonc     # Cloudflare Worker & D1 binding configuration
├── package.json
└── tsconfig.json
```

## ⚙️ Getting Started

### Prerequisites

- Node.js 20+
- Cloudflare account with Wrangler CLI
- Telegram Bot Token ([@BotFather](https://t.me/BotFather))
- Google Gemini API Key ([Google AI Studio](https://aistudio.google.com/))

### Installation

```bash
git clone https://github.com/soheilabbasnia/trendscope.git
cd trendscope
npm install
```

### Local Development

```bash
npm run dev
```

### Deployment

```bash
npm run deploy
```

## 📄 License

MIT © [Soheil Abbasnia](https://github.com/soheilabbasnia)
