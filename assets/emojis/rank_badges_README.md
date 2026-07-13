# Rank Badge Emojis

Shield-style numbered badges (1–10) used in the live leaderboard canvas and text-based leaderboards.

## Setup

1. Save the full rank badges strip image as `assets/emojis/rank_badges_strip.png`
2. Run: `node scripts/crop-rank-badges.js`
3. This generates `rank1.png` through `rank10.png` (128×128 each)
4. Upload all 10 to your bot's emoji server
5. Update the IDs in `utils/rankEmojis.js`

## Files

| File | Rank | Style |
|------|------|-------|
| rank1.png | #1 | Gold shield with crown |
| rank2.png | #2 | Silver shield |
| rank3.png | #3 | Bronze/amber shield |
| rank4.png | #4 | Purple shield |
| rank5.png | #5 | Blue shield |
| rank6.png | #6 | Cyan shield |
| rank7.png | #7 | Green shield |
| rank8.png | #8 | Orange/amber shield |
| rank9.png | #9 | Pink/magenta shield |
| rank10.png | #10 | Gray/silver shield |

## How it works

- The **canvas leaderboard** loads badge images directly from `assets/emojis/rank{N}.png` (local files).
- If local files are missing, it falls back to CDN URLs in `utils/rankEmojis.js`.
- For ranks > 10, a plain `#N` text label is rendered instead.
- **Text-based leaderboards** use the Discord emoji format from `RANK_EMOJIS` in `utils/rankEmojis.js`.
