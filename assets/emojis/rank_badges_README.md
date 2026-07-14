# Rank & Rarity Badges

Two badge sets, both generated programmatically and auto-uploaded to the bot's
Application Emojis (via `manifest.json` + `utils/emojiAutoSync.js`).

## Rank badges (leaderboards) — `rank1.png` … `rank10.png`
Ornate pennant badges for leaderboard positions 1–10.
- Regenerate: `node scripts/generate-rank-badges.js`
- Canvas cards load the local PNGs directly (`utils/rankEmojis.js` → `RANK_BADGE_FILES`).
- Message text resolves the live app emoji **by name** (`rank1`…`rank10`) via
  `emojiGuard.remapByName` in `getRankEmoji()` — no hardcoded IDs.

## Rarity badges (anime + economy) — `rarity_<tier>.png`
Crystal-gem badges for the 6 tiers (common → mythic).
- Regenerate: `node scripts/generate-rarity-badges.js`
- Canvas cards load them via `utils/rarityBadges.js` → `loadRarityBadge()`.
- Message text resolves live by name (`rarity_common`…`rarity_mythic`) via
  `getRarityEmoji()`, falling back to Unicode circles before the guard loads.

## New token / deployment
On startup `emojiAutoSync` detects a new application id (new token) and uploads
every bundled emoji (including these badges) automatically, then refreshes the
emoji guard so names resolve to the freshly-uploaded IDs. If you add or change
badge images, run `node scripts/rebuild-emoji-manifest.js` so the manifest picks
them up before the next boot.
