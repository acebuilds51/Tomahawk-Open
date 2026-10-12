# Tomahawk Open — Roommates Scramble scoreboard

Live scoreboard for the Roommates Scramble at the Tomahawk Open 2026, a 24-player golf trip.
Six "rooms" of 4 players each play a 4-man scramble. Scorekeepers enter hole scores on their
phones and every phone shows the leaderboard.

- Live site: https://acebuilds51.github.io/Tomahawk-Open/ (path is case-sensitive)
- Repo: acebuilds51/Tomahawk-Open, branch `main`, GitHub Pages from `/ (root)`. The repo must stay
  **public**: Pages needs that on this account's free plan.
- Owner: Tony (GitHub `acebuilds51`; the old `tonyedmonds2003` account is retired, so never use it).
  Tony develops on Windows and pushes with **GitHub Desktop**, not a terminal. When you change
  files, tell him what to commit; don't assume he can run git commands.
- **Players have no accounts of any kind.** Anyone with the link must be able to view and save.
  That rules out anything that needs a sign-in (this is why the app left Claude artifacts).

## Files

| File | What it is |
|---|---|
| `index.html` | Roommates Scramble: one HTML file with inline CSS and JS, no build step and no framework. |
| `ryder-cup.html` | Ryder Cup (Red vs Blue, 6 two-man matches). Same pattern and same backend as `index.html`. |
| `logo.png` | Tomahawk Open logo (327×316), used in the header and as the icon. |
| `apps-script/Code.gs` | Backend for both pages. Lives in a Google Sheet's Apps Script project. **Not run from this repo**: this file is the source of truth to paste into the Apps Script editor. |
| `tests/smoke.js` | Runs the real `index.html` against the real `Code.gs` on a simulated Sheet (Node + jsdom). |
| `tests/smoke-rc.js` | Same for `ryder-cup.html`; prints PASS/FAIL per check and exits 1 on any failure. |

## Architecture

```
phone (index.html on GitHub Pages)
   │  GET  /exec          → full state JSON (polled every 10 s, and on tab focus/online)
   │  POST /exec (text/plain JSON body) → {action:'score'|'clear'|'ticks', ...} → returns full state
   ▼
Google Apps Script web app (Code.gs)  →  Google Sheet tabs "Scores" and "Ticks"
```

- POST uses `Content-Type: text/plain` on purpose: it's a "simple" request, so the browser
  sends no CORS preflight (Apps Script can't answer one). Keep it that way.
- Apps Script redirects to `script.googleusercontent.com`; `fetch` follows that fine.
- Writes are serialized with `LockService` (10 s wait; the client sees `{ok:false,error:'busy'}` and retries).
- Every POST returns the full state, so the client never needs a second GET after saving.

### Client behaviour (index.html)
- **Settings block** at the top of the script: `API_URL`, `EVENT_LINE`, `PAR`, `HCP`
  (stroke index per hole), `TEAMS` (room id + player nicknames). Change course, date or rooms there.
- **Offline queue**: saves go into `localStorage['rm27-queue']`, are applied on screen
  immediately, then sent one at a time; a failed send retries every 8 s. A newer save for the
  same room and hole replaces an unsent older one. While anything is queued, polling sends
  instead of loading, so the screen never flips back to stale Sheet data.
- Other storage keys: `rm27-cache` (last state from the Sheet, so the page paints instantly),
  `rm27-keeper` (scorekeeper tools shown), `rm27-team` (last room picked). Bump the `KEY`
  prefix for a new event so old phones don't carry stale data.
- Status line under the leaderboard: "● Live · last score h:mm", or "No connection,
  retrying · N saves waiting for signal".

### Scoring rules (match the printed rules on the page)
- Each room's score = strokes − par over the holes played, minus that room's **strokes**
  allowance (`strokes` in `TEAMS`, can be 1.5; the full amount comes off, like the paper card).
  Lower is better. Halves display as "½".
- **Ghost holes** are an allowance per room, set in `TEAMS`: `ghosts` = how many, `perSide` =
  that many on the front 9 and that many on the back 9 (otherwise any time). The scorekeeper taps
  "Used one here" when saving a hole; the page blocks going over the allowance. A used ghost hole
  is stored in the Scores tab's Drive column as `Name|ghost` (no backend change was needed).
  Cards show a G on those holes and "Front used (#1) · Back available" or "1 of 3 used".
- Threesomes: a room's `p` list can have 3 players; `note` shows on its card. The 2-drives rule
  still applies to each player listed.
- 2026-10-12 values came from the committee's cards: 1707 and 905 = 1.5 strokes, 3 ghost holes
  any time; 505 = 3 strokes, 4 any time; 906, 205, 1605 = 0 strokes, 1 per side. 906 and 1605
  played as threesomes (Chub-Rock and Smitty out) with an extra ball each shot (no score change).
- The older committee panel (per-hole ticks and ghost holes in the `Bonus` tab, PIN-protected)
  was removed from the page that morning; the backend still supports the `bonus` action.
- **Drives**: every save must say whose tee shot was used (Scores column E, `Drive`). Each card
  counts drives per player (rule: at least 2 each) and warns once a room is close to running
  out of holes to get everyone to 2.
- Ties use countback: compare holes in stroke-index order (hardest first: 3, 13, 6, 2, 1, …),
  using only holes both rooms have played. If it's still tied, both rooms show `T`.
- Top 3 rooms win a pot (gold position numbers and a "Pot N" badge).

## Backend (apps-script/Code.gs)
- The script must be **bound to the Sheet** (created from the Sheet via Extensions → Apps
  Script). `SpreadsheetApp.getActive()` returns null in a standalone script.
- `setup()` creates the `Scores` (Room, Hole, Strokes, Saved at, Drive), `Ticks` (old
  per-room totals, no longer used by the page) and `Bonus` (Room, Tick holes, Ghost holes)
  tabs, plus the Ryder Cup tabs. It only adds what's missing, so rerun it after pasting a new
  version. **It must be run by hand.** Without it, GET still works (`readState_` tolerates
  missing tabs) but every save throws, and the browser reports that as "Failed to fetch"
  (an error page from Google has no CORS headers). This happened at launch.
- `resetRound()` clears all scores and ticks; run it by hand from the editor before a new round.
- **Committee PIN**: saving ticks/ghost holes (`bonus`, old `ticks`) and Ryder Cup matchups
  (`matches`) requires `pin` to match the Script Property `COMMITTEE_PIN` (Apps Script editor →
  Project Settings → Script Properties). Never put the PIN in this repo: it's public. Errors:
  `bad_pin` (the page clears its remembered PIN and says so) and `no_pin` (property not set,
  so those saves are refused). Score entry stays open to everyone by design. Each page
  remembers the PIN in `localStorage` (`rm27-pin`, `rc27-pin`) after it's typed once.
- Deployment: Web app, **Execute as: Me**, **Who has access: Anyone** (not "Anyone with a
  Google account": that sends phones to a sign-in page and breaks the page).
- After editing Code.gs in the editor: Deploy → Manage deployments → pencil → Version:
  **New version** → Deploy. That keeps the same `/exec` URL. A brand-new deployment gets a
  new URL, which would then have to go into `API_URL`.
- Current `/exec` URL is in `API_URL` in index.html.

## Look and feel
- Theme: **Oxblood** (chosen 2026-10-12, replacing green). Colors are CSS custom properties
  on `:root`, with a dark-mode set under `prefers-color-scheme: dark` (and `[data-theme="dark"]`).
  Main tokens: `--board #561520`, `--board-row #6b2231`, `--board-muted #dcb3b9`,
  `--bg #f7f2f1`, `--gold #e6b54d`, `--gold-ink #8a5f0e` (text on the gold badge).
  `<meta name="theme-color">` matches `--board`.
- Fonts: Barlow and Barlow Condensed from Google Fonts.
- Phone-first, one column, max width 760px. Under 420px wide the leaderboard hides its
  "Thru N" column; each room's card still shows it.
- Birdie or better squares are red tinted, par is neutral, over par is blue tinted.

## Testing
```
cd tests
npm install jsdom
node smoke.js
```
`smoke.js` loads `../apps-script/Code.gs` into a simulated SpreadsheetApp, points the page's
`fetch` at it, and covers: save, update, remove, ticks, the offline queue plus reconnect, a
second phone seeing the scores, and `resetRound`. Run it after any change to either file.
It never touches the live Sheet.

To check the live backend from a browser console on the Pages site:
`await fetch(API_URL).then(r=>r.json())` should return `{scores:{...},ticks:{...},updated}`.

## Ryder Cup (ryder-cup.html)
- Live at `https://acebuilds51.github.io/Tomahawk-Open/ryder-cup.html`. Ported from the old
  Claude artifact on 2026-10-12 (the artifact needed a Claude sign-in to save).
- Same `/exec` URL as the Roommates page. Every Ryder Cup request carries `game=rc`
  (GET query string, POST body field); without it the script answers for the Roommates page.
- Sheet tabs: `RC Matches` (Match, Tees, Red 1, Red 2, Blue 1, Blue 2, who tees off on 7 for
  each side as 1 or 2) and `RC Scores` (Match, Hole, Red, Blue, Saved at). `setup()` creates
  them and seeds the matchups from `RC_DEFAULT`; it never overwrites existing tabs.
  `resetRyderCup()` clears scores and keeps matchups.
- POST actions: `score` {match 1–6, hole, red, blue}, `clear` {match, hole},
  `matches` {matches: 6 × {tees, red:[a,b], blue:[a,b], redAlt, blueAlt}}.
- Scoring: match play. Each hole goes to the lower score; the pair that wins more holes takes
  the match (1 point), tied after 18 is ½ each. A match ends early once the lead is bigger than
  the holes left ("3&2"). 6 points, 3½ wins; 3–3 is a putt-off. Holes 1–6 best ball,
  7–12 alternate shot (tee shots alternate by hole, starting with `redAlt`/`blueAlt`),
  13–18 scramble.
- Names: matchups store the names the captains write (e.g. `Kurt`, `Pat B.`). The page shows
  them with nicknames via `NICK` (name → nickname) and `REAL` (nickname-only name → real
  first name) in the settings block. `PLAYERS` is the setup dropdown list.
- Storage keys use the `rc27` prefix. Phone layout: under 560px the Red/Blue steppers stack
  so the score box fits a 375px screen (side by side they need ~400px).

## Related
- Tony's other apps use the same stack (single-file HTML PWA on GitHub Pages plus a Google
  Apps Script / Sheets backend), so follow their conventions.
