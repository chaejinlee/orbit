# Orbit

**Plan together, go together.** Orbit turns scattered ideas — reels, map links, "we should try this" notes — into a plan a group can actually follow. People collect ideas on a shared visual board, shape a shared itinerary draft in real time, and confirm it as an immutable, versioned plan that is checked against hard constraints (time window, fixed reservations, travel time, budget).

Orbit has been taking shape since August 2026: the idea and the product design came first, and the code followed in November.

> Status: Phase 1 foundation (core planning), the first AI features (plan options and Ask Orbit, on Google Gemini's free tier), and the start of Phase 2: invite links, people management, comments on cards, and a free canvas around the cards (write anywhere, photos, emoji stickers, arrows between anything, mind-map style), all live on everyone's screen. Orbit opens on a phone on the same Wi-Fi and can sit on its home screen like an app ([On your phone](#on-your-phone-same-wi-fi)); for now invites work on that Wi-Fi too ([Inviting people](#inviting-people-same-wi-fi-for-now)). Decided for a later update: answers checked against Google Maps. Polls and Go Mode come after that — see [Roadmap](#roadmap).

## What works today

| Area | Details |
| --- | --- |
| **Home & creation** (H01, C01, C02) | Plan list, type tiles, minimal create form (only the type is required), idempotent creation, Hybrid Entry screen |
| **Board** (W01) | React Flow canvas on top of a Yjs document: live dragging between collaborators, presence, undo of *your own* edits (⌘Z), remove-from-board vs archive, status filters. Pan, pinch or ⌘-scroll to zoom, Shift-drag to select several things, move them together |
| **Free canvas** | Around the idea cards: **text** anywhere (double-click the board), as plain text or a colored note, in three sizes; **emoji stickers** (quick picks or any emoji); **arrows** between any two things, drawn from the knob on an item's right edge or with the arrow tool, and letting go on empty space starts a new connected note, like a mind map. Everyone sees typing, moves and resizing live, and two people can type in the same box at once |
| **Photos** | Add them with the photo button, by dropping files on the board, or by pasting. The browser shrinks each photo first; the server re-encodes it (at most 2048 px, WebP) and drops its metadata, so a phone photo's location never reaches the group. Resize keeping the shape, double-click to see it full size. Photo files are only reachable through short-lived signed links |
| **Add idea** (W02) | Link / Place / Activity / Note. Links are cleaned (tracking params, fragments) and Google/Apple Maps links are read for a place name and coordinates — without fetching the page |
| **One place, many ideas** | Duplicate detection by link key, name similarity (Hangul-aware) and distance. "Add to the existing idea" is offered, never forced; a retried merge never attaches twice |
| **Inspector** (W03) | Shortlist, interest, user estimates (clearly marked unverified), sources, Open in Maps |
| **Itinerary** (T01) | Shared draft: drag/keyboard reorder, durations, pinned times, lock, travel legs (default travel is labeled *estimate*), costs. Schedule and checks recompute live |
| **Confirm** (T02) | Change summary, hard-constraint checklist (violations must be accepted one by one), optimistic concurrency with a clear conflict flow, version history and restore-to-draft |
| **Plan options** (I01/I02) | One button, three labeled options (Balanced / Budget / Experience) from the board's ideas. A deterministic planner checks every combination against the time window, pinned times, locked stops and the budget; Gemini only reads the optional note and words the headlines. Chips (relaxed, fit in more, less travel, spend less) instead of typing. “Use this plan” is one undoable draft change |
| **Ask Orbit** (W05, on demand) | Quick-question chips on every card (Hours, Price, Reservations, Getting there, Good to know) or your own question. Answers stay **private to the asker until they press Share**, and can be hidden. For now they come from Gemini's general knowledge and the card says “Not checked against Google Maps or the web”; answers checked against Google Maps / Search, with sources, are a [later update](#google-maps-checks-later-update) |
| **Invite links** (W06) | **Share** makes a link that adds people as *Can edit* or *Can view*, expiring after 1, 7 or 30 days, optionally for one person only. Copy it, show its QR code, or use the share sheet. Whoever made a link, or the owner, can turn it off. The join page shows who invited you to what, and with which role, before you tap Join. The server keeps only a hash of each link's secret |
| **People** | The owner changes roles and removes people; anyone else can leave. Links stop working when the person who made them leaves, is removed or becomes a viewer, so nobody gets back in through a link of their own |
| **Comments** (W05) | One thread per card for everyone in the plan, viewers included. Edit or delete your own; the owner can delete anyone's. Cards show how many comments they have. A double-tapped Send posts once |
| **Live updates** | Comments, card edits, new members, role changes and confirmed versions show up on everyone's screen within a second. A role change applies at once: a new viewer's screen turns read-only, and a removed member loses the plan |
| **Access control** | Owner / Editor / Viewer matrix shared by API, realtime server and UI. Non-members get 404. Removed members lose their open socket within seconds. Viewers read shared AI answers and comment, but can't spend AI |
| **Mobile** | Ideas list instead of the canvas, Ideas/Plan tabs, bottom-sheet details, also with the phone turned sideways (the computer layout needs a window at least 768 px wide and 512 px tall) |
| **On your phone** | `npm run dev:phone` opens Orbit to phones on the same Wi-Fi: a QR code on the computer, a 6-digit sign-in code, and Add to Home Screen opens it full-screen with Orbit's icon. Other devices can't use the dev sign-in without the code |

## Quick start

Requirements: Node 20.19+ (24 recommended). No Docker or system Postgres needed — `npm run dev` runs an embedded Postgres from `node_modules`.

```bash
npm install
cp .env.example .env
npm run dev          # Postgres (embedded) + API :4000 + realtime :4001 + web :3000
```

In a second terminal, load the sample plan:

```bash
npm run db:seed
```

Open http://localhost:3000 and use the development sign-in (`demo@orbit.dev` is the owner of the sample plan).
To see collaboration, open http://127.0.0.1:3000 (a separate origin has separate storage) and sign in as `sam@orbit.dev`, or use a private window.

The servers listen on this computer only (`BIND_HOST=127.0.0.1`), because the development sign-in has no password.

### On your phone (same Wi-Fi)

Orbit runs on this computer; a phone on the same Wi-Fi can open it in its browser and keep it on the home screen.

```bash
npm run dev:phone    # like npm run dev, but reachable from this Wi-Fi (BIND_HOST=0.0.0.0) for this run
```

1. In Orbit on the computer, click the phone icon at the bottom of the left rail (**Open on your phone**). It shows a QR code, the address (such as `http://192.168.1.23:3000`) and a 6-digit sign-in code. The API log prints the same.
2. Scan the QR code with the phone's camera. The link fills in the code; pick an account (or type an email) to sign in.
3. To keep it as an app: on iPhone, Safari's Share button → **Add to Home Screen**; on Android, Chrome's ⋮ menu → **Add to Home screen**. It opens with Orbit's name and icon. On iPhone it opens full-screen and asks for the code once, because a home-screen app has its own storage.

Good to know:

- **Only while the computer runs it.** Close the lid or stop `npm run dev:phone` and the phone can't reach Orbit. Using Orbit away from this Wi-Fi needs a deployment (Phase 4).
- **The code.** Only devices other than this computer need it. It's new every time the API starts and changes after 10 wrong tries; phones that already signed in stay signed in (sessions last 30 days).
- **macOS may ask** whether “node” may accept incoming network connections. Allow it, or the phone can't connect.
- **Some networks keep devices apart** (many campus, office and café Wi-Fis). If the page doesn't load on the phone, try home Wi-Fi or connect the computer to the phone's hotspot.
- **A new address** (another network, or the router hands out a new one): open **Open on your phone** again for the new QR code. A home-screen icon keeps the old address, so add it again.
- **Android:** Chrome may open the icon as a normal tab instead of full-screen, because installing as an app needs HTTPS (it comes with the deployment).
- To go back to this computer only, stop it (Ctrl+C) and run `npm run dev`.

### Using the board

| To | Do |
| --- | --- |
| Write something | Double-click empty space, or the **T** button. Esc or ⌘Enter when done; an empty box disappears |
| Style text | Select it: colors, S / M / L, Edit and Delete appear above it. Drag the bar on its right edge to make it wider |
| Add photos | The photo button, drop files on the board, or paste (⌘V). Up to 10 at a time |
| Add a sticker | The sticker button: pick one, or type any emoji (⌃⌘Space opens the emoji keyboard on a Mac) |
| Draw an arrow | Hover an item and drag the round knob on its right edge onto another item. Let go on empty space to start a new note connected to it. Or turn on the arrow tool and drag from anything to anything (Esc to stop) |
| Delete | Select and press Delete (an arrow: click it, then its ×). A card is only taken off the board; the idea stays |
| Undo | ⌘Z undoes your own changes only, never someone else's |
| Select several | Shift-click, or Shift-drag a box, then drag them together |

Viewers see everything and can open photos, but can't change the board.

### Inviting people (same Wi-Fi, for now)

1. Start Orbit with `npm run dev:phone`. Without it, invite links point at `localhost` and open only on this computer (the Share dialog says so).
2. Open a plan → **Share** → pick *Can edit* or *Can view* → **Create invite link**. Copy the link and send it, or show its QR code to someone next to you.
3. They open it on their phone or laptop (on the same Wi-Fi), sign in with the 6-digit sign-in code from **Open on your phone**, and tap **Join**.

Good to know:

- **The sign-in code is the development sign-in's only lock**, and the sign-in has no password: whoever has the code can sign in with any email, yours included. Give it only to people you'd hand your laptop to. Real accounts (Google sign-in) and invites that work anywhere come with the deployment.
- **A link is shown in full only on the device that made it.** The server keeps a hash, not the link. Lost it? **Show link** works on that device; anywhere else, make a new one.
- **Opening an old link when you're already in the plan** just opens the plan. Links never change the role of someone who's already in it.

## Orbit AI (Google Gemini)

AI is optional: without a key, plan options still work (plain headlines) and cards show how to turn Ask Orbit on.

1. Create a free key at https://aistudio.google.com/api-keys (a Google account; no credit card for the free tier).
2. Paste it into `.env` yourself: `GEMINI_API_KEY=...` (never into a chat or a commit).
3. Restart `npm run dev`. The API logs `Orbit AI: gemini (gemini-3.5-flash-lite)`.

| Setting | Default | Notes |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Google's current stable Flash-Lite. Free tier: plain calls (options, note reading, headlines) cost nothing. Paid: $0.30 / $2.50 per 1M input/output tokens. `gemini-2.5-flash-lite` is closed to keys created since late 2026 |
| `AI_DAILY_LIMIT` | `40` | AI requests per person per rolling 24 h. Each “3 options” run that used AI counts as one, each question as one |
| `AI_PROVIDER` | (auto) | `gemini` when a key is set, `fake` for canned answers while building UI (dev only), `off` |

Prices and quotas are Google's as of November 2026 and change often: check https://aistudio.google.com/docs/pricing.
On the free tier Google may use prompts and answers to improve its products, so turn on billing before real users' data goes through it. What Orbit sends: the card's title, place (name, address, coordinates), saved links, the plan's city, and the plan date for opening-hours questions. Never member names, emails or other plans.

### Google Maps checks (later update)

Decided on November 9, 2026: Orbit stays on the free tier for now, and answers checked against Google Maps come in a later update.

- **Today:** Gemini 3+ models can't use Google Maps / Search grounding on the free tier. Orbit asks for it, Gemini refuses, and Orbit asks again without it, so the answer comes from the model's general knowledge. The card says “Not checked against Google Maps or the web” (no sources, no “Checked” time), and the prompt keeps hours and prices from sounding confirmed.
- **Already built:** Google Maps grounding for place cards (Google Search otherwise), sources under the answer, the “Checked” time, and the fallback above. Tests cover it without the network (a scripted model and a fake Gemini client). It hasn't run against real Google Maps yet, because that needs billing.
- **To turn it on:** open https://aistudio.google.com/api-keys and press **Set up billing** next to the key's project (minimum $5 prepay; prepaid credits expire 12 months after purchase). No code change: the next question is grounded. Then ask “Hours” on a place card and check that Google Maps sources appear under the answer.
- **Cost after that:** the project moves to a paid tier, so calls are billed at the paid rates in the table above (a fraction of a cent per question). Grounding is free for the first 5,000 requests a month (Maps and Search together), then $14 per 1,000. Set a monthly cap at https://aistudio.google.com/spend; auto-reload of credits is optional. When prepaid credits run out, every key on that billing account stops (HTTP 402): questions say so (`AI_BILLING`), and plan options still come back with plain headlines, without reading the note. Details: https://aistudio.google.com/docs/billing.

## Repository layout

```
apps/
  web/        Next.js 16 · React 19 · Tailwind 4 · React Flow · TanStack Query
  api/        NestJS 12 modular monolith (auth, plans, ideas, itinerary, sharing, comments, photos, AI)
  realtime/   Hocuspocus 4 (Yjs) — board layout, canvas items + shared itinerary draft
packages/
  shared/     Isomorphic domain: zod schemas, permissions, link parsing, duplicate
              detection, scheduling, validation, diffing, Yjs document helpers
  db/         Prisma 7 schema + migrations, client, session tokens, local Postgres
docs/
  architecture.md   Data authority, document schema, commit protocol, decisions
scripts/
  dev-phone.mjs     npm run dev:phone (npm run dev, reachable from this Wi-Fi)
```

## Architecture in one picture

```
 Browser (Next.js)
   ├── HTTP ──────────────▶ API (NestJS) ─────────┬──▶ Photo files (disk now,
   │   plans, ideas, commits, guards: session +     │     object storage later)
   │   invites, comments,     permission matrix     ▼
   │   photos (+ signed links for <img>)
   └── WebSocket ─────────▶ Realtime (Hocuspocus) ─▶ Postgres
       Yjs: board layout,    same token, same        SQL truth + Yjs state
       canvas items, arrows, membership checks
       itinerary draft;
       "changed" hints
```

- **SQL is the source of truth** for anything that needs validation, permissions or history (ideas, members, comments, votes, confirmed versions).
- **The Yjs document** holds what benefits from merging: card layout, the free canvas (text, stickers, where photos sit, arrows) and the shared itinerary *draft*.
- **Photos** are files with a row in SQL; the canvas only refers to them by id. The browser loads them from signed links that name one photo and work for an hour or two.
- **A draft becomes history only through a commit**: re-validated on the server and guarded by `expectedVersion`.
- **Live updates for SQL data** travel as content-free hints over the same socket ("comments on card X changed"); each screen refetches over HTTP, where permissions apply.

Details and the reasoning behind each choice: [docs/architecture.md](docs/architecture.md).

## Testing

```bash
npm test          # all packages
npm run typecheck # all packages
```

| Suite | What it proves |
| --- | --- |
| `packages/shared` (99 unit tests) | Scheduling `start(B) ≥ start(A) + duration(A) + travel(A→B)`, constraint validation, LIS-based diffing, link canonicalization, duplicate scoring, permission matrix, and CRDT convergence: concurrent moves never duplicate or mix coordinates, concurrent inserts order identically, offline delete wins, undo touches only local edits. Phone helpers: ids without `crypto.randomUUID` (a phone over http), localhost service URLs follow the page's host, which origins and Host headers count as this computer or this Wi-Fi. Sharing: invite links keep the token after `#`, only real tokens are read back, no owner-role links, comment limits, and live hints keep only known topics and safe ids. Canvas: two people typing in one text box keep both edits, edits never split an emoji, a concurrent move and resize each land whole, one arrow per direction (two people drawing the same one get one), deleting an item deletes its arrows, malformed or look-alike items are skipped, undo only touches your own canvas edits, stickers are emoji only |
| `packages/shared` planner (part of the 99) | Options never break the window, pinned times, locked stops (kept in order, same ids) or the budget; skip / must-include / end-with are honored; relaxed days are lighter; unpopular ideas drop out; the draft reproduces the option's times exactly |
| `apps/api` (69 integration + 8 unit tests) | Against a real throwaway Postgres: idempotent creation under concurrent double-submit, 404-for-non-members, viewer restrictions, plan-scoped idea ids, merge idempotency, **exactly one winner among concurrent commits**, hard constraints blocked unless explicitly accepted. AI (with a scripted model): note ids are validated, locked stops kept, answers private until shared, unsafe source links dropped, Maps vs web grounding, double-tap asks once, provider errors explained, daily limit, options still work when AI can't be used, unchecked answers when the key can't ground, the plan's own times/budget echoed back aren't credited to the note. Gemini adapter (no network): error mapping (closed model → suggested replacement, 402, refused grounding), no SDK retries, one retry on 5xx, safe citation links only. Phone mode: another device needs the code this computer shows (missing or wrong codes refused, a new code after 10 misses), the code is only shown on this computer, Wi-Fi origins are allowed only in phone mode and only on the web port, a Host header that isn't localhost (DNS rebinding) doesn't count as this computer, and without phone mode the dev sign-in stays on this computer. Sharing: only owners and editors make links, the token is stored only as a hash, previews work signed out, expired / turned-off / used-up links are explained, **a one-person link lets exactly one of five simultaneous joiners in**, a double-tapped Join counts once, a link never changes an existing member's role (no promoting yourself after being made a viewer), links die with their creator's right to invite, removing someone takes their access and interest marks but keeps their comments, the owner can't be demoted, removed or leave. Comments: viewers can comment, strangers get 404, one comment per request id even when sent twice at once, edit only your own, owner moderation, plan-scoped ids, counts skip deleted comments. Photos: shrunk and re-encoded to WebP, turned upright, metadata and GPS dropped; owners and editors only; non-images (an HTML or SVG file posing as a photo), empty and oversized uploads explained; the same upload sent twice at once is stored once; an upload id can't be reused for another plan; each plan sees only its photos; a per-plan limit; signed links refused when tampered with, for the other size, expired or too far in the future, and stable within the hour |
| `apps/realtime` (6 integration tests) | Real WebSocket clients: draft sync + persistence, rejected forged/non-member sessions, read-only viewers, removed member's socket closed and their in-flight edit dropped. Hints: a viewer's hint reaches the others stamped with the sender's id (extra fields dropped, no echo), malformed hints are dropped, and one connection can't send more than 30 per 10 seconds |

Integration tests start their own embedded Postgres on a free port (and the photo tests their own uploads folder); nothing else needs to be running.

## Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Everything, one terminal |
| `npm run dev:phone` | The same, reachable from phones on this Wi-Fi (see [On your phone](#on-your-phone-same-wi-fi)) |
| `npm run db:start` | Only the local Postgres (applies migrations) |
| `npm run db:migrate -- --name <change>` | Create a migration after editing `schema.prisma` (needs an interactive terminal) |
| `npm run db:seed` | Sample plan with two users |
| `AI_PROVIDER=fake` in `.env` | Canned AI answers for UI work without a key |
| `UPLOADS_DIR` in `.env` | Where photo files go (default `.data/uploads`, next to the local database) |

## Roadmap

Decided for a later update:

- **Google Maps checks for Ask Orbit:** built; waiting on billing for the Gemini key. See [Google Maps checks](#google-maps-checks-later-update).

Phases:

- **Phase 2 — collaboration:** ✅ invite links (role, expiry, one-person links, turn off), people (roles, remove, leave), comments on cards (W05), live updates, free canvas (text, photos, stickers, arrows). Next for the canvas: the canvas on phones (the phone's Ideas list doesn't show text, photos or stickers yet), comments on photos, cleaning up photos deleted from the board (kept for now so ⌘Z can bring them back), labels on arrows. Then: polls and Decision Room (D01), member constraints (must-have / nice-to-have, private visibility), map view (M01).
- **Phase 3 — intelligent planning:** ✅ three labeled options, Lock & Regenerate (locked stops are kept), note reading, Ask Orbit (private-first, shareable). Next: answers checked against Google Maps (above), opening-hours checks inside options, real travel times (Google Maps Routes API), `@Orbit` in comment threads, multi-day trips, the Suggestion and Smart Auto modes.
- **Phase 4 — production:** Go Mode and Smart Plan B, offline persistence, Google sign-in, Playwright E2E, CI, observability, deployment (Orbit away from home Wi-Fi, over HTTPS, installable on Android too). Deployment plus Google sign-in is also what lets invite links work for people anywhere, so it may be worth doing before the rest of Phase 2.

## Troubleshooting

- **Unstyled pages:** a catch-all `*` in a parent folder's `.gitignore` (virtualenv writes one into `~/.gitignore`) hides source files from Tailwind's scanner. The root `.gitignore` starts with `!*` to neutralize that; keep it.
- **Port in use:** the dev database uses `5433`, the API `4000`, realtime `4001`, web `3000` (`DATABASE_URL`, `API_PORT`, `REALTIME_PORT`, `WEB_PORT` in `.env`; change `NEXT_PUBLIC_*_URL` with them).
- **A photo says “Photo unavailable”:** its file is gone from `.data/uploads`, or `UPLOADS_DIR` now points somewhere else.
- **`prisma migrate dev` refuses to run:** it needs an interactive terminal. Run it yourself in a terminal, not through a script.
