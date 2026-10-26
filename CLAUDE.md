# Tomahawk Open — Roommates Scramble scoreboard

Live scoreboard for the Roommates Scramble on the Tomahawk Open, a yearly golf trip. Rooms of
3–4 players each play a scramble. Scorekeepers enter hole scores on their phones and every phone
shows the leaderboard. The committee sets up each event (course, rooms, strokes, ghost holes,
starting nines) on a PIN-protected setup page, and every past event stays viewable.

- Live site: https://acebuilds51.github.io/Tomahawk-Open/ (path is case-sensitive)
  - Committee setup: `/setup.html` · A past event: `/?event=<id>` · Ryder Cup: `/ryder-cup.html`
- Repo: acebuilds51/Tomahawk-Open, branch `main`, GitHub Pages from `/ (root)`. The repo must stay
  **public**: Pages needs that on this account's free plan. Never commit phone numbers or the PIN.
- Owner: Tony (GitHub `acebuilds51`; the old `tonyedmonds2003` account is retired, so never use it).
  Tony develops on Windows and pushes with **GitHub Desktop**, not a terminal. When you change
  files, tell him what to commit; don't assume he can run git commands.
- **Players have no accounts of any kind.** Anyone with the link must be able to view and save.
  That rules out anything that needs a sign-in (this is why the app left Claude artifacts).
- The players are skeptical and not tech-savvy. Test layout at 375px width before shipping, and
  prefer changes that don't need an Apps Script redeploy on a round day.

## Files

| File | What it is |
|---|---|
| `index.html` | Roommates scoreboard: one HTML file with inline CSS and JS, no build step and no framework. Shows the current event, or a past one with `?event=<id>`. |
| `setup.html` | Committee page (PIN): create/edit events and courses, choose which event is on the scoreboard, mark events final. |
| `ryder-cup.html` | Ryder Cup (Red vs Blue, 6 two-man matches). Same backend; not event-based yet. |
| `logo.png` | Tomahawk Open logo (327×316), used in the header and as the icon. |
| `apps-script/Code.gs` | Backend for all pages. Lives in a Google Sheet's Apps Script project. **Not run from this repo**: this file is the source of truth to paste into the Apps Script editor. |
| `tests/smoke.js` | Runs the real `index.html` and `setup.html` against the real `Code.gs` on a simulated Sheet (Node + jsdom), starting from the pre-events Sheet with the Oct 12 round. |
| `tests/smoke-rc.js` | Same for `ryder-cup.html`. Both print PASS/FAIL per check and exit 1 on any failure. |

## Architecture

```
phone (index.html / setup.html on GitHub Pages)
   │  GET  /exec                 → current event + its scores (polled every 10 s, on focus/online)
   │  GET  /exec?event=<id>      → that event + its scores (history view; not polled)
   │  GET  /exec?list=1          → all events (newest first) + courses + current id
   │  POST /exec (text/plain JSON) score | clear            → returns that event's state
   │                              saveEvent | saveCourse | setCurrent | setStatus | checkPin (PIN) → returns the list
   ▼
Google Apps Script web app (Code.gs)  →  Sheet tabs "Events", "Courses", "Scores" (+ Ryder Cup tabs)
```

- POST uses `Content-Type: text/plain` on purpose: it's a "simple" request, so the browser
  sends no CORS preflight (Apps Script can't answer one). Keep it that way.
- Apps Script redirects to `script.googleusercontent.com`; `fetch` follows that fine.
- Writes are serialized with `LockService` (10 s wait; the client sees `{ok:false,error:'busy'}` and
  retries). Live test 2026-10-12: 6 simultaneous saves all landed, the slowest in ~10 s.
- **Deploy order matters**: paste/redeploy `Code.gs` first, then push the pages. The new script
  still answers the old page; a new page against an old script shows "No connection".

### Data model
- `Events` tab: Id, Name, Date (YYYY-MM-DD), Course, Status (`live` | `final`), Config (JSON:
  rooms, plus a snapshot of the course's par/hcp/place so editing a course never changes past
  results), Updated. Ids look like `2027-10-15-roommates-scramble`.
- Room config: `{id, p:[players], strokes (0.5 steps), ghosts, perSide, start (1|10), note}`.
- Script Property `CURRENT_EVENT` = the event the main link shows. `setup.html` changes it.
- `Courses` tab: Name, Where, Par (18, comma list), Hole handicaps (18, comma list, 1..18 once each).
  Seeded with Meadowlands GC and Blackmoor GC.
- `Scores` tab: Room, Hole, Strokes, Saved at, Drive (`Name` or `Name|ghost`), Event (id).
  Scores for a `final` event are refused (`event_final`).
- The first event `2026-10-12-roommates` (Meadowlands, 6 rooms, final) was created by `setup()`,
  which filed every pre-events score row under it. Backup of that round's GET is not in the repo.

### Client behaviour (index.html)
- Only `API_URL` is a setting; course, rooms and rules all come from the event.
- **Offline queue**: saves go into `localStorage['rm27-queue']` with their event id, are applied on
  screen immediately, then sent one at a time; a failed send retries every 8 s. A newer save for
  the same event, room and hole replaces an unsent older one. While anything is queued, polling
  sends instead of loading. The queue survives closing the page, but only sends while the page is open.
- Other storage keys: `rm27-cache` (`-<id>` suffix for history views), `rm27-keeper`, `rm27-team`.
- **Starting nine**: a room with `start:10` plays 10–18 then 1–9; the hole picker and "next hole"
  follow that order. "Thru N" counts holes played; a `*` marks back-nine starters.
- **Drive required**: Save without a drive shows the error *directly above the Save button* and
  outlines the drive buttons (the Oct 12 complaint was an error shown off-screen at the top).
- Final or past events are read-only (no scorekeeper tools). Footer "Past events" lists all events.
- Status line: "● Live · last score h:mm", "No connection, retrying · N saves waiting for signal",
  or "Final results".

### Scoring rules (match the printed rules on the page)
- Room score = strokes − par over the holes played, minus the room's **strokes** allowance (full
  amount, like the paper card). Lower is better. Halves display as "½".
- **Ghost holes**: allowance per room (`ghosts`, `perSide` = that many per nine). Scorekeeper taps
  "Used one here"; the page blocks going over. Cards show G and "Front used (#1) · Back available".
- **Drives**: at least 2 per listed player; cards count them and warn late in the round.
- Threesomes: 3 players listed; the rules text mentions the extra ball. No score change.
- Ties use countback on the event's hole handicaps (hardest first), only holes both rooms played.
- Top 3 rooms win a pot (gold position numbers and a "Pot N" badge).

## Backend (apps-script/Code.gs)
- The script must be **bound to the Sheet** (Extensions → Apps Script from the Sheet).
- `setup()` adds missing tabs/columns, seeds courses and the first event, files untagged scores
  under the first event, and sets `CURRENT_EVENT` if unset. Safe to rerun; run it after every paste.
- `resetRound()` deletes the **current event's** scores only. Past events are never touched.
- **Committee PIN**: Script Property `COMMITTEE_PIN` (Project Settings → Script Properties). Never
  in the repo. Needed for all setup actions and Ryder Cup matchups. Errors `bad_pin` / `no_pin`.
  `setup.html` remembers it in `localStorage['tom-pin']`.
- Deployment: Web app, **Execute as: Me**, **Who has access: Anyone** (not "Anyone with a
  Google account": that sends phones to a sign-in page and breaks the page).
- After editing Code.gs in the editor: Deploy → Manage deployments → pencil → Version:
  **New version** → Deploy. That keeps the same `/exec` URL (it's in `API_URL` in each page).
- Old `Ticks` and `Bonus` tabs from Oct 12 are unused leftovers; the actions that wrote them are gone.

## Look and feel
- Theme: **Oxblood**. Colors are CSS custom properties on `:root`, with dark-mode sets under
  `prefers-color-scheme: dark` and `[data-theme="dark"]`. Main tokens: `--board #561520`,
  `--board-row #6b2231`, `--board-muted #dcb3b9`, `--bg #f7f2f1`, `--gold #e6b54d`,
  `--gold-ink #8a5f0e`. `<meta name="theme-color">` matches `--board`. Ryder Cup uses navy/red/blue.
- Fonts: Barlow and Barlow Condensed from Google Fonts.
- Phone-first, one column, max width 760px. Under 420px the leaderboard hides its "Thru" column.
- Birdie or better squares are red tinted, par is neutral, over par is blue tinted.

## Testing
```
cd tests
npm install jsdom
node smoke.js
node smoke-rc.js
```
Run both after any change to a page or `Code.gs`. They never touch the live Sheet. `smoke.js`
covers migration of the Oct 12 round, setup.html (PIN, new event copied from the last one,
starting nines, adding/removing rooms), courses, back-nine hole order, the drive error position,
offline queue, ghost holes and strokes, history view and the Past events list, final events
refusing scores, and `resetRound`.

For a phone-width preview without touching the live Sheet, serve the repo with `API_URL` pointed
at a local stand-in that runs `Code.gs` in Node (same fake Sheet as the tests).

To check the live backend: `GET <API_URL>` returns `{event:{...}, scores, drives, updated}` and
`GET <API_URL>?list=1` returns `{events, courses, current}`.

## Ryder Cup (ryder-cup.html)
- Live at `https://acebuilds51.github.io/Tomahawk-Open/ryder-cup.html`. Ported from the old
  Claude artifact on 2026-10-12. Not used on the 2026 trip. Not event-based yet (natural next step:
  give it events/history like the Roommates page).
- Same `/exec` URL. Every Ryder Cup request carries `game=rc` (GET query, POST body field).
- Sheet tabs: `RC Matches` (Match, Tees, Red 1, Red 2, Blue 1, Blue 2, who tees off on 7 for
  each side as 1 or 2) and `RC Scores` (Match, Hole, Red, Blue, Saved at). `resetRyderCup()`
  clears scores and keeps matchups.
- POST actions: `score` {match 1–6, hole, red, blue}, `clear` {match, hole},
  `matches` (PIN) {matches: 6 × {tees, red:[a,b], blue:[a,b], redAlt, blueAlt}}.
- Scoring: match play, 1 point per match, ½ each if tied after 18; 3½ of 6 wins. Holes 1–6 best
  ball, 7–12 alternate shot, 13–18 scramble. Course pars/hcp are Blackmoor, hard-coded.
- Names: `NICK` / `REAL` maps add nicknames/real first names; `PLAYERS` is the setup dropdown list.
- Storage keys use the `rc27` prefix. Under 560px the Red/Blue steppers stack.

## Related
- Tony's other apps use the same stack (single-file HTML PWA on GitHub Pages plus a Google
  Apps Script / Sheets backend), so follow their conventions.
