<div align="center">

# xNico

**An all-in-one Discord bot with a real-time web dashboard.**

[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-optional-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/license-ISC-blue?style=flat-square)](LICENSE)

[Support Server](https://discord.gg/Zs35X7Umak)

</div>

---

## Overview

xNico is a large, modular Discord bot — **600+ commands across 17 categories** covering moderation, security, music, economy, leveling, automation and social systems — paired with a **browser-based control panel** that configures every module in real time. The bot uses discord.js v14 with Components V2 throughout for a modern, button-driven interface, and persists state in PostgreSQL with a transparent local-file fallback.

### Highlights

- **Security** — Anti-Nuke, Anti-Raid, Anti-Alt, AutoMod (native + custom filters), verification, emergency lockdown, and detailed audit logging.
- **Music** — Lavalink-powered playback (YouTube, Spotify, SoundCloud, Apple Music) with filters, lyrics, autoplay, 24/7 mode and saved playlists.
- **Economy** — Per-guild custom currency, banking, shops, a suite of gambling games, fishing, hunting, pets and PvP.
- **Leveling** — XP tracking with customizable rank cards, level roles, multipliers and leaderboards.
- **Engagement** — Welcomer, tickets, giveaways, starboard, polls, suggestions/feedback, birthdays, social notifications and a scheduled meme poster.
- **Dashboard** — Configure modules, edit message/welcome embeds, customize rank & profile cards, manage premium, and view analytics from the web.

---

## Web Dashboard

The dashboard (in [`dashboard/`](dashboard/)) is an Express app serving a single-page control panel. Administrators sign in with **Discord OAuth2**, pick a server they manage, and configure modules through dedicated panels.

- **Live sync** — Changes save straight to the shared data store. When the bot and dashboard run in one process the update is applied instantly; across separate hosts they sync through PostgreSQL within a few seconds.
- **Covers** — AutoMod, Anti-Nuke/Raid, welcomer, leveling, economy, tickets, reaction roles, logging, the message builder, profile/rank card customization, premium key management and more.
- **Auth** — Hand-rolled JWT sessions over an httpOnly cookie; OAuth redirect URIs are auto-detected per request so the same build works on localhost and any deployed domain.

> **Cross-host requirement:** when the dashboard and bot run on different hosts (e.g. dashboard on a serverless platform, bot on a VM), both **must** point at the **same** `DATABASE_URL`. PostgreSQL is the only shared channel between separate processes. See [Environment Variables](#environment-variables).

---

## Command Categories

| Category | Focus |
|:---|:---|
| `admin` | Moderation, AutoMod, Anti-Nuke/Raid/Alt, verification, logging, premium panels |
| `utility` | Tickets, giveaways, starboard, polls, reminders, invite tracking, AFK |
| `owner` | Bot management, eval, deploy, broadcasting, maintenance |
| `economy` | Currency, shop, gambling, fishing, pets, battles, custom shop |
| `fun` / `games` | Trivia, Akinator, hangman, wordle, memes, mini-games |
| `music` | Full Lavalink player — filters, queue, favorites, panels |
| `basic` | Server/user/role info, permissions, help |
| `voice` | Join-to-create, voice roles, VC management |
| `image` | Blur, greyscale, rotate, pixelate, deepfry, sepia and more |
| `leveling` | XP, rank cards, level roles, multipliers |
| `backup` | Config backups and full server-structure backups |
| `action` | Roleplay/expression commands (hug, pat, …) |
| `social` | Profiles, badges, marriage, reputation |
| `automation` | Welcomer, autoresponder, autoreact, social-notify, scheduled posters |
| `stats` | Server stat channels and activity leaderboards |
| `webhook` | Create, send, edit, delete and manage webhooks |

Run `/help` (or the configured prefix, default `-`) for the interactive menu with per-category dropdowns, in-place pagination and a search modal.

---

## Premium

xNico has **user-tier** and **server-tier** premium; either unlocks the full feature set within its scope. Owners mint redeemable keys.

| Capability | Free | Premium |
|:---|:---:|:---:|
| Core music, moderation, economy, leveling | ✓ | ✓ |
| Bot customization (prefix, colour, branding) | — | ✓ |
| Custom server currency & custom shop | — | ✓ |
| Rank & profile card customization | — | ✓ |
| Suggestions, feedback & confessions | — | ✓ |
| AI chat, Vanity Guard, Threat Mode | — | ✓ |
| Ticket setup with custom panels | — | ✓ |
| Join-to-Create interfaces | 1 | up to 10 + role gating |
| Music 24/7 mode & downloads | — | ✓ |

Redeem with `/redeemkey <KEY>` (user) or `/redeemserverkey <KEY>` (server); owners generate keys with `/genkey`.

---

## Tech Stack

| Component | Technology |
|:---|:---|
| Runtime | Node.js 18+ |
| Library | discord.js v14 |
| Music | Lavalink + lavalink-client |
| Rendering | `@napi-rs/canvas` |
| Storage | PostgreSQL (`pg`) with local-file fallback |
| Dashboard | Express, JWT, Discord OAuth2 |
| Sharding | discord.js `ShardingManager` |

---

## Architecture & Data

State lives in `utils/jsonStore.js` — an in-memory cache backed by PostgreSQL:

- **Reads** are synchronous from cache. **Writes** update the cache immediately and persist to PostgreSQL. High-value config stores persist instantly; hot, high-churn stores (economy, XP) are debounced to protect performance.
- **No database?** If `DATABASE_URL` is unset or unreachable, the store transparently falls back to JSON files in `json_stores/`. The public API is identical.
- **Bot ↔ dashboard sync** is handled by `utils/storeSync.js`, which maps store updates to the bot's in-memory cache invalidators — instantly in-process, or via a short PostgreSQL poll across hosts.
- **Graceful shutdown** flushes all unsaved data to the database before exit; the shard manager forwards the signal and waits for the flush to complete so restarts don't drop recent changes.

---

## Self-Hosting

### Prerequisites

- **Node.js** 18 or newer
- A bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- **Java 17+** — only if you want music (Lavalink)
- **PostgreSQL** — optional; omit to run on local JSON files

### Setup

```bash
git clone <your-fork-url> xnico
cd xnico
npm install
cp .env.example .env      # then fill in TOKEN, CLIENT_ID, OWNER_ID, …
```

### Run

```bash
npm start                 # starts the dashboard + the sharded bot (start.sh)
```

Individual processes:

```bash
npm run start:bot         # bot only (sharded, via shard.js)
npm run start:bot:noshard # bot only (single process)
npm run start:dashboard   # dashboard only
npm run start:lavalink    # Lavalink music server (requires Java)
```

The dashboard's npm dependencies live in `dashboard/` and install automatically on first `npm start`; to install manually: `cd dashboard && npm install`.

### Discord OAuth2 (for dashboard login)

In the Developer Portal → **OAuth2**:

1. Copy the **Client Secret** into `DISCORD_CLIENT_SECRET`.
2. Under **Redirects**, add your dashboard callback URL(s), e.g.
   `http://localhost:3500/api/auth/discord/callback` and your production
   `https://your-domain/api/auth/discord/callback`.

`DISCORD_REDIRECT` can be left blank — the server auto-detects it from the request host.

---

## Environment Variables

Copy [`.env.example`](.env.example) to `.env`. Required values are marked ✓.

### Core

| Variable | Req | Description |
|:---|:---:|:---|
| `TOKEN` | ✓ | Discord bot token |
| `CLIENT_ID` | ✓ | Application (client) ID |
| `OWNER_ID` | ✓ | Your Discord user ID (full owner access) |
| `PREFIX` | | Default message-command prefix (default `-`) |
| `LOG_LEVEL` | | `NONE` \| `ERROR` \| `WARN` \| `INFO` \| `DEBUG` |

### Database

| Variable | Req | Description |
|:---|:---:|:---|
| `DATABASE_URL` | | PostgreSQL connection string. Omit to use local JSON files. **Required for cross-host bot ↔ dashboard sync.** |
| `FALLBACK_DATABASE_URL` | | Secondary connection string used on failover |

### Dashboard

| Variable | Req | Description |
|:---|:---:|:---|
| `DASHBOARD_PORT` | | Dashboard HTTP port (default `3500`) |
| `DISCORD_CLIENT_SECRET` | ✓¹ | OAuth2 client secret — **required for dashboard login** |
| `DISCORD_REDIRECT` | | OAuth2 callback URL; blank = auto-detect from request host |
| `JWT_SECRET` | ✓¹ | Secret for signing dashboard sessions (set a long random value in production) |
| `DASHBOARD_CORS_ORIGINS` | | Comma-separated allowed browser origins (only when frontend ≠ API origin) |
| `FRONTEND_URL` | | Public dashboard base URL |

<sub>¹ Required only if you run the dashboard.</sub>

### Integrations (optional)

| Variable | Description |
|:---|:---|
| `GROQ_API_KEY` | Powers AI chat, AI moderation and screenshot verification |
| `TENOR_API_KEY` / `GIPHY_API_KEY` | GIF providers for action commands |
| `WEBHOOK_PORT` | Top.gg / vote webhook port (default `3000`) |
| `TOPGG_TOKEN` / `TOPGG_WEBHOOK_SECRET` | Top.gg server-count posting and vote webhooks |
| `SUPPORT_SERVER` / `BOT_WEBSITE` | Branding links shown in `/botinfo` |

See `.env.example` for the complete annotated list.

---

## Project Structure

```
xnico/
├── index.js                # Bot entry point (gateway, events, command loader)
├── shard.js                # Sharding manager + dashboard launcher
├── start.sh                # Convenience launcher (dashboard + bot)
├── commands/               # 17 category folders of command modules
├── events/                 # Gateway event handlers
├── utils/                  # Shared libraries
│   ├── jsonStore.js        # PostgreSQL-backed store (+ local fallback)
│   ├── storeSync.js        # Bot ↔ dashboard cache sync
│   ├── database.js         # User/guild data access layer
│   ├── premiumManager.js   # Premium key & tier logic
│   ├── levelCard.js        # Rank card renderer
│   ├── profileCard.js      # Social profile card renderer
│   └── …
├── dashboard/              # Express control panel (server + public SPA)
├── config/                 # Lavalink node config
├── lavalink/               # Lavalink configuration
└── assets/                 # Fonts, images, badges
```

---

## Support

- **Discord:** [discord.gg/Zs35X7Umak](https://discord.gg/Zs35X7Umak)

---

<div align="center">

Built by **Rajeev** · Licensed under ISC

</div>
