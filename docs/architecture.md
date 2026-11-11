# Orbit architecture

This document records how Orbit's data flows and *why* it is built this way. It complements the product spec (UX Spec v1.1) — when the code deviates from the spec, the reason is written down here.

## 1. Processes

| Process | Stack | Responsibility |
| --- | --- | --- |
| `apps/web` | Next.js 16, React 19, Tailwind 4, React Flow 12, TanStack Query | UI. Reads SQL-backed data over HTTP; edits the board, the free canvas and the draft through Yjs; shrinks photos before uploading them |
| `apps/api` | NestJS 12 (modular monolith) | Auth, plans, ideas, itinerary versions, invites and members, comments, photos, Orbit AI. Owns every validated write and every LLM call |
| `apps/realtime` | Hocuspocus 4 | One Yjs document per plan. Auth + membership on connect and while open; persists to Postgres; relays "changed" hints (§9) |
| Postgres | Prisma 7 + `@prisma/adapter-pg` | System of record (SQL tables + Yjs snapshots) |
| Photo storage | Local disk (`UPLOADS_DIR`, default `.data/uploads`) behind `PhotoStorage` | Re-encoded photo files. A deployment needs a persistent disk or object storage behind the same interface (§10) |
| Google Gemini | Interactions API (`@google/genai`) | Reads the optional note, words option headlines, answers card questions: with Google Maps / Search grounding once the key has billing, until then from general knowledge, labeled “Not checked” (decision 13). Called only by the API |

No microservices beyond what has a different runtime profile: realtime holds long-lived sockets. The planner (see §8) runs in-process; a separate solver worker is only worth it once plans outgrow exact search.

## 2. Data authority

| Data | Where | Why |
| --- | --- | --- |
| Users, membership, roles, invites | SQL | Security decisions must be authoritative and auditable |
| Ideas (place/link/note/activity), sources, reactions | SQL | Validated, searchable, needed by mobile lists, AI context and history |
| Card layout (position, hidden) | Yjs | Merges naturally; two people dragging different cards never conflict |
| **Free canvas**: text, stickers, where photos sit, arrows | Yjs | Whiteboard content: merges like layout, typing merges character by character, no server rules beyond what readers check (§10) |
| **Photos**: the files, and a row per photo | Storage + SQL | Uploads need validation and re-encoding on the server; the row scopes a photo to its plan and backs the signed links (§10) |
| **Itinerary draft** | Yjs | The group edits it together, live and offline-tolerant |
| **Confirmed itinerary versions** | SQL, immutable | History, conflict detection, the thing people actually follow |
| Comments, invite links, AI logs; votes *(Phase 2)* | SQL | Each needs server-side validation |
| Presence (who's online) | Yjs awareness | Ephemeral; never persisted |
| "Something changed" hints | Realtime socket (stateless messages) | Content-free and ephemeral: they only tell other screens what to refetch over HTTP (§9) |

### Deviation from the spec: notes are SQL ideas

The spec placed "layout/notes" in the CRDT. Orbit stores note *ideas* in SQL like every other card; only the layout is in Yjs. A note can become an itinerary stop, needs an author and timestamp (FR-IDEA-05), gets comments (W05), and must be readable by the mobile list and the AI without loading a CRDT. Concurrent edits to one short note are rare; last write wins there.

### Card status is derived, never stored

`saved / shortlisted / in plan / needs decision / archived` comes from `deriveIdeaStatus()`. "In plan" is computed from the draft and the confirmed version, so a card's badge can never disagree with the itinerary. Only `shortlisted` is a stored user choice.

## 3. The plan document (Yjs)

One `Y.Doc` per plan, named `plan:<planId>` (validated by `planIdFromDocName`).

```
nodes : Y.Map<ideaId, Y.Map>     card layout, keyed by idea id
          pos    {x, y}          ONE atomic value
          hidden boolean         "remove from board" (the idea stays)
draft : Y.Map<stopId, Y.Map>     shared itinerary draft
          order  {dayIndex, position}   ONE atomic value (fractional index)
          ideaId, title, durationMin, fixedStartMin, locked,
          travelMinFromPrev, costMinor, costCurrency   independent registers
items : Y.Map<itemId, Y.Map>     free canvas items that aren't ideas (ids start with "it_")
          kind   text | photo | sticker      fixed when created
          pos    {x, y}   size {w, h}         each ONE atomic value
          createdAt                           stable stacking order
          text   Y.Text                       (text) merges concurrent typing
          color, textSize                     (text) registers
          photoId                             (photo) a plan_photos row
          emoji                               (sticker)
links : Y.Map<linkId, Y.Map>     arrows (ids start with "ln_")
          from, to                            idea ids or item ids
meta  : Y.Map                    schemaVersion, draftBaseVersion
```

Design choices, each covered by a test in `packages/shared/test/yboard.test.ts`:

- **Keyed by idea id** — an idea has at most one card, and two clients that auto-place the same new idea write the same key instead of creating two cards.
- **Atomic `pos`** — with separate `x`/`y` registers, two concurrent drags could converge to one user's x and the other's y. A single value means one drag wins whole.
- **Fractional indexes instead of `Y.Array`** — moving an item in a `Y.Array` is delete + insert, so a stop moved by two people at once can be duplicated. A map of stops with a sortable `position` key cannot duplicate; ties from concurrent inserts break on stop id (identical order on every replica), and the day is re-keyed when a later insert lands between tied keys.
- **Atomic `order`** — a concurrent move can't combine one user's day with the other's position.
- **Local-origin transactions** — every helper writes with `LOCAL_ORIGIN`, so `Y.UndoManager` undoes only the local user's edits (spec: "Cmd+Z undoes your own action").
- **Defensive readers** — any client can write anything into a CRDT, so readers validate and skip malformed entries; an invalid duration is surfaced by the validator rather than making a stop vanish.
- **Canvas items are their own map** — item ids carry a prefix, so a hand-written entry can't pose as an idea's card; readers drop unknown kinds, photo ids that aren't ids, stickers that aren't emoji, and clamp sizes.
- **Text is a `Y.Text`** — the editor applies only the changed range (one delete, one insert, never splitting an emoji's surrogate pair), so two people typing in the same box keep both edits, and the other person's cursor stays put.
- **One arrow per direction** — two people drawing the same arrow offline both write one; readers keep the smallest id. Deleting an item deletes its arrows in the same step; an arrow to a card taken off the board just isn't drawn, and comes back with the card.

## 4. Confirming a plan (commit protocol)

```
Browser                                API                                Postgres
  │ POST /plans/:id/itinerary/commits   │                                      │
  │ { expectedVersion: 1, stops,        │                                      │
  │   acceptedIssueCodes, note }        │                                      │
  │────────────────────────────────────▶│ 1. every stop.ideaId ∈ this plan     │
  │                                     │ 2. schedule + validate (same code    │
  │                                     │    the browser ran); errors not in   │
  │                                     │    acceptedIssueCodes → 422          │
  │                                     │ 3. BEGIN                              │
  │                                     │    UPDATE plans SET currentVersion+1 │
  │                                     │    WHERE id=… AND currentVersion=1 ──▶│ row lock; re-check
  │                                     │    0 rows → 409 VERSION_CONFLICT     │
  │                                     │    INSERT version 2 + stops          │
  │                                     │    COMMIT                             │
  │◀────────────────────────────────────│ 201 version 2                        │
  │ set meta.draftBaseVersion = 2 (Yjs) │                                      │
```

- The browser commits **the draft it reviewed**, not whatever the draft became meanwhile.
- The conditional `UPDATE` serializes concurrent commits on the plan row; `UNIQUE(planId, version)` is a second guard. The integration test fires three commits at once and asserts exactly one `201`.
- On `409` the dialog refetches, re-diffs against the new version and explains what happened. It never overwrites silently.
- Confirmed versions are immutable; stop titles are snapshotted so history stays readable if an idea is renamed or archived.

### Hard constraints are never relaxed silently

The validator (`validateItinerary`) reports `error` / `warning` / `info`. Errors (late for a fixed time, outside the plan window, over budget, invalid duration, empty plan) block a commit unless the user ticks each one, and the accepted codes are recorded in the activity log. Unknowns stay unknown: no start time means no clock times, missing costs produce "budget check incomplete", and costs in another currency are never converted.

## 5. Access control

`PERMISSIONS` in `@orbit/shared` is the single matrix. Viewers can view, react, vote and comment, but cannot edit the board or itinerary or spend AI budget.

- **HTTP:** a global `AuthGuard` (session token → existing user) plus `PlanAccessGuard` on every `/plans/:planId/...` controller. Routes must declare `@RequirePermission`; a missing declaration fails closed (500), never open. Non-members get **404**, so plan ids can't be probed. Ids nested under a plan (ideas) are always scoped by `planId` in the query.
- **WebSocket:** the same token and membership lookup in `onAuthenticate`; viewers get a read-only connection. Membership is re-checked on incoming messages (at most every 10 s): a removed member's next update is dropped and the document is closed with `Forbidden`; a downgraded editor becomes read-only.
- **Dev sign-in:** only "this computer" may use it freely: a loopback socket address *and* a loopback `Host` header, so a page that points its own domain at 127.0.0.1 (DNS rebinding) doesn't count. Anyone else is refused with `LOCAL_ONLY`, or in phone mode asked for the code (`PHONE_CODE`).
- **Photo files** are a public route that checks a signed link instead of a session (§10). Uploading needs `photo.upload` (owners and editors); listing a plan's photos, and so getting links, needs membership.
- **Public routes** (`@Public`) skip the session requirement but still read a valid session when one comes along, so the invite preview can say "you're already in this plan". An invalid or stale token on a public route is ignored, not an error.

### Invite links and people

- **Tokens.** 24 random bytes as base64url (32 characters, 192 bits). The API returns the token once, to its creator; `invite_links.tokenHash` keeps only its SHA-256, so a database leak leaks no working links. The creator's browser keeps the tokens it made in `localStorage` so **Show link** works there; nowhere else can the full link be shown again.
- **The link** is `<web origin>/join#<token>`. The token sits in the fragment, which browsers never send to a server, and travels to the API in a POST body, so it reaches no URL log. In development the Share dialog builds links from this computer's Wi-Fi address when phone mode is on (`GET /auth/phone`), and warns that links open only here when it's off.
- **Who.** Owners and editors make links (`invite.create`) with role *editor* or *viewer* (never owner), an expiry of 1, 7 or 30 days, and optionally one use. The creator or the owner (`invite.manage`) turns a link off. At most 20 working links per plan.
- **Preview** (`POST /invites/preview`, public): plan name, type, date, city, the first eight members' names, the inviter, the role and the expiry. No emails. Distinct codes for `INVITE_INVALID` (404) and `INVITE_EXPIRED` / `INVITE_REVOKED` / `INVITE_USED_UP` (410). Members get the preview even for a dead link, so an old link still opens the plan for them.
- **Joining** (`POST /invites/accept`): an existing member gets `joined: false` and **keeps their role**: a link never promotes or demotes anyone, so an editor made a viewer can't promote themselves with their own old link. A new member claims a use with a conditional `UPDATE … SET "useCount" = "useCount" + 1 WHERE <not revoked, not expired, uses left>` inside the transaction that inserts the membership. Concurrent joins serialize on the row and Postgres re-checks the `WHERE` after a competing commit, so a one-person link admits exactly one of many simultaneous joiners (tested with five). The same person double-tapping Join gets one membership and one use: the loser either finds the membership or hits the primary key and rolls back its claimed use.
- **People.** The owner changes roles and removes people (`member.manage`); anyone but the owner can leave. The owner can't be demoted, removed or leave (no ownership transfer yet). **Every working link was made by a current member who can still invite:** links are turned off when their creator leaves, is removed or becomes a viewer, so nobody walks back in through a link of their own. Leaving or removal also deletes that person's "interested" marks (they say who wants to go *now*); their comments stay, as part of the conversation.

### Phone mode (same Wi-Fi)

`npm run dev:phone` sets `BIND_HOST=0.0.0.0` for one run, so the web app, API and realtime server are reachable at this computer's Wi-Fi address (Postgres stays on localhost). It stays a development setup:

- **Sign-in code.** `PhoneAccess` keeps a random 6-digit code in memory: new on every API start, replaced after 10 wrong tries, compared in constant time. `GET /v1/auth/phone` returns it, with the computer's private IPv4 addresses (physical interfaces first), only to this computer; the web app shows it as a QR code (`http://<address>:3000/#code=…`, a fragment so it never reaches a server log) under **Open on your phone**. Sessions issued to a phone are ordinary 30-day tokens.
- **Addresses.** The browser derives the API and realtime URLs from the page's host when they're configured as localhost (`withPageHost`), so `.env` needs no per-network change. The API's CORS allows `http://<private IPv4 or name.local>:<web port>` only in phone mode; Next's `allowedDevOrigins` gets the private ranges as wildcards. Both follow a new address without a restart.
- **Not a secure context.** A page served over `http://192.168.x.y` has no `crypto.randomUUID`, so ids come from `randomId()`, which falls back to `crypto.getRandomValues`.
- **Home screen.** `app/manifest.ts` (standalone display, icons in `public/icons`, maskable variant) and `apple-icon.png` let phones add Orbit to the home screen. iPhone opens it full-screen with its own storage; Android needs HTTPS for full app mode, which comes with deployment.

## 6. Idempotency

Clients generate a `clientRequestId` once per form or dialog and reuse it on retries.

- Plans: `UNIQUE(createdById, clientRequestId)`
- Ideas: `UNIQUE(planId, clientRequestId)`
- Merges into an existing idea: `UNIQUE(planId, clientRequestId)` on the created source
- Comments: `UNIQUE(authorId, clientRequestId)`, one id per message, so a double-tapped Send posts once
- Photos: `UNIQUE(uploadedById, clientRequestId)`, one id per photo; the losing copy of a doubled upload deletes the files it wrote
- Joining a plan: needs no key; a second join by the same person returns `joined: false` and uses nothing (see §5)

A replay returns the original result with `replayed: true`; a race on the unique index returns the winner.

## 7. Link import without scraping (V1)

`normalizeLink` strips tracking parameters, credentials and fragments, rejects non-http(s) schemes, and builds a canonical key (`instagram.com/p/<id>` for posts and reels alike, `youtube.com/watch?v=<id>` for youtu.be and shorts). `parseMapsLink` reads place names and coordinates that Google and Apple Maps share URLs carry in the URL itself (`!3d…!4d…` pinned coordinates win over the `@lat,lng` viewport). Nothing is fetched, so private posts and platform terms are respected and there is no SSRF surface yet. Short links (`maps.app.goo.gl`) will need a guarded server-side redirect lookup in Phase 2.

## 8. Orbit AI

```
Browser ──"3 options" (draft, chips, note?)──▶ API ─┬─ note? ──▶ Gemini: note → JSON (ids Orbit offered only)
                                                     ├─ planner (deterministic, @orbit/shared) ─▶ 3 options
                                                     └─ headlines ─▶ Gemini: wording from the facts only
Browser ──"Hours" chip──▶ API ──▶ Gemini + Google Maps grounding ──▶ answer + sources ──▶ ai_responses (PRIVATE)
                                                                     Share ──▶ visibility = SHARED (all members)
```

**The model never plans.** `planProposals()` searches every subset and order of up to 13 candidate ideas (dynamic programming over subsets, exact at this size) and keeps only schedules that meet the hard constraints: the time window, pinned times, locked stops (kept in their order, with their ids) and the budget. Three objective profiles pick Balanced / Budget / Experience, each made distinct. Every option is re-validated with the same `validateItinerary()` the commit uses, carries per-stop reasons, what was left out and why, and tradeoffs against Balanced. Anything it can't honor ("end with dessert" past 9 PM) is reported, never hidden.

**What the model does.** (1) Reads the optional note into a fixed JSON schema; Orbit keeps only ids it offered and values that parse, shows "What Orbit understood", and lists what it can't do yet. (2) Rewords the headlines from the computed facts. (3) Answers card questions with grounding. If the model is off, out of quota or failing, options still come back with plain headlines; questions return a clear error (`AI_OFF`, `AI_LIMIT`, `AI_BUSY`, `AI_KEY`, `AI_MODEL` with the model Google suggests, `AI_BILLING` when prepaid credits run out). SDK retries are off (a 429 would otherwise wait out Retry-After for 30 s+); a 5xx is retried once.

**Provider seam.** Services depend on the `AiModel` interface (DI token `AI_MODEL`); `GeminiModel` is the only file that knows the SDK. `FakeModel` (`AI_PROVIDER=fake`, refused in production) serves canned answers for UI work, and tests inject a scripted model.

**Ask Orbit rules.**
- Private first: `ai_responses.visibility` starts `PRIVATE`; only the asker can share. Other members don't learn a private answer exists (404).
- Grounding: Google Maps for place cards (English prompts only, a Maps limitation) biased to the place's coordinates; Google Search otherwise. Sources are stored in `ai_sources` with the time they were checked. Only http(s) links reach the browser.
- No grounding on the key — the current mode, since Google Maps checks are deferred to a later update (decision 13). Gemini 3+ on the free tier answers the tool call with a quota error, so Orbit asks again without tools, with a prompt that forbids presenting hours or prices as confirmed. The answer is stored with `grounding: none`, no sources and no `checkedAt`, and the API returns `checkedWith: null` so the card says “Not checked”.
- Display: sources sit directly under the answer, Google Maps sources are attributed with an untranslated “Google Maps”, and answers without sources are flagged as unverified.
- Sent to Google: the card's title, place, saved links, the plan's city, and the plan date for opening hours. Never member names, emails, other cards' discussions or other plans. Requests use `store: false`.
- Idempotent per `(asker, clientRequestId)`, so a double-tap asks (and bills) once. A per-person daily cap protects the free tier.

**Travel estimates.** An untimed leg is estimated from the two places' coordinates (`estimateTravelMinutes`: walk short hops, ride longer ones, rounded up to 5 minutes; 15 minutes when a location is unknown) and always labeled "estimate". The browser, the commit validator and the planner use the same estimator, so an applied option shows exactly the times it promised and the server agrees at commit.

## 9. Collaboration: comments and live updates

**Comments** (W05) are SQL rows on an idea: plain text up to 1,000 characters, one flat thread per card (the schema's `parentId` and `AI_RESPONSE` kind are reserved for replies and `@Orbit`). Every member can comment, viewers included (`comment.create`). People edit and delete their own; the owner can delete anyone's (`comment.moderate`). Deleting sets `deletedAt`: the row stays for the activity log (`comment.deleted` records whether it was moderation) and disappears from every list and count. Ids are always scoped by the plan in the query, so an id from another plan is a 404. Archived ideas take no new comments. `IdeaDTO.commentCount` puts the count on cards.

**Live updates.** The board and the draft are live through Yjs, but comments, card edits, members and confirmed versions live in SQL. After a successful change, the browser sends a stateless message over the plan's socket:

```
{ "type": "changed", "topics": ["comments", "ideas"], "ideaId": "…" }
```

The realtime server parses it against a whitelist (`plan`, `ideas`, `comments`, `answers`, `itinerary`; ids `[A-Za-z0-9_-]{1,64}`; at most 512 characters), drops anything else, stamps it with the sender's user id (never trusting a client's `by`), and relays it to the plan's other connections, at most 30 per connection per 10 seconds. Each screen then refetches just that data over HTTP, where the permission checks are. Read-only (viewer) connections can send hints: `readOnly` blocks Yjs updates, not stateless messages, and every incoming message goes through the same membership re-check.

- **Why hints, not data:** a hint can't show anyone anything they couldn't fetch, so the socket needs no second permission system. A lost hint only delays a refresh; comments also refetch every 60 seconds and AI answers every 30.
- **Why from the browser:** one socket and one auth path that already exist. With more than one API instance, the API should publish these events itself (decision 18).
- **Role changes apply at once:** a `plan` hint refetches the plan; when your role changed, the workspace reconnects the socket (`epoch` in `usePlanDoc`) so a new viewer gets a read-only connection right away instead of at the next periodic re-check. A removed member's refetch gets a 404 and the screen says the plan is gone.
- **New members:** when someone online isn't in the member list (they just joined), the workspace refetches the plan once per new set of strangers, the same way unknown cards on the board trigger an ideas refetch.

## 10. The free canvas and photos

**Canvas.** The board is one React Flow surface with five node types: idea cards (SQL ideas placed by `nodes`), text, photos and stickers (`items`), and upload placeholders that exist only on the uploader's screen. Photos sit at the bottom, then cards, then text and stickers, so a label can go on a photo. Every edit goes through `@orbit/shared/yboard` helpers with the local origin, so ⌘Z undoes only your own canvas edits, typing included. Moves of several selected things are one write (`moveBoardNodes`), streamed once per animation frame while dragging.

**Arrows.** React Flow only draws an edge between handles it has measured, so every item keeps one small source handle (the knob on its right edge). Arrows are drawn border to border between the two items' boxes, not handle to handle. While an arrow is being dragged, every other item gets a full-size drop target; with the arrow tool every item is a full-size start, and handles are re-measured when the tool changes. Letting go on empty space creates a text item there, already connected, which is the mind-map gesture.

**Photos.**

```
Browser                           API                                      Storage / SQL
  shrink: upright, ≤2048 px,      POST /plans/:id/photos?clientRequestId   (editor or owner)
  re-encode (drops metadata) ───▶  ≤15 MB body, image types only ─▶ sharp: decode (≤60 MP), rotate,
                                                                   ≤2048 px WebP + 640 px thumb,
                                                                   all metadata dropped ──▶ files
                                                                   row in plan_photos ────▶ SQL
  addPhotoItem(photoId) (Yjs)  ◀── PhotoDTO with signed links
  <img src="/v1/photos/:id/thumb?exp&sig">  ──▶ GET (public route): HMAC check, row lookup, file
```

- **Re-encoded on the server, always.** The browser's shrinking is a courtesy (fast uploads on mobile data, and Safari can read HEIC, which the server can't). The server decodes whatever arrives with sharp and writes a new WebP, so nothing but pixels survives: no GPS location, no camera details, no polyglot file. Anything that doesn't decode as JPEG, PNG, WebP, GIF or AVIF is a 415 (`PHOTO_UNSUPPORTED`). Animated GIFs keep their first frame.
- **Signed links, because an `<img>` can't send the session header.** A link names one photo, one size (`full` or `thumb`) and an expiry; the signature is an HMAC with a key derived from `AUTH_SECRET` for this purpose only. Links work for one to two hours and stay the same within each hour, so the browser caches them; the photo list refreshes every 40 minutes, and a photo that fails to load gets fresh links and one retry. Tampered, cross-size, expired or far-future links are a 403. Files are served with `nosniff`, a sandboxing CSP and `private` caching. A link someone copies works for the rest of that window, the same trade-off as presigned object-storage links.
- **Storage keys come only from server ids** (`<planId>/<photoId>.<size>.webp`), checked again before touching the disk. `PhotoStorage` has a local-disk implementation; object storage can implement `put`, `remove` and `send` (a redirect to a short-lived storage link) without changing anything else.
- **Idempotent and bounded.** One photo per `(uploader, clientRequestId)`: a retried or doubled upload returns the first one and its files are written once. 300 photos per plan; 10 per drop or paste.
- **Removing a photo from the board keeps the file** (and its row), so ⌘Z can bring it back. Unreferenced photos aren't cleaned up yet: that needs a job that reads which photo ids the plan's Yjs document still uses.

**Placement.** New photos, stickers and toolbar text go to the free spot nearest the middle of the view (searched in rings around it), and a photo is placed only once its shape is known, so nothing new lands on or under a card. Double-clicking and dropping put things exactly where you point.

## 11. Engineering decisions log

| # | Decision | Why |
| --- | --- | --- |
| 1 | Draft in Yjs, confirmed versions in SQL | Free collaborative editing where it helps; strict, versioned truth where it matters |
| 2 | Derived card status | One source of truth for "in plan" |
| 3 | Explicit `@Inject(token)` everywhere, no `emitDecoratorMetadata` | Runs under tsx/esbuild and Vitest's Oxc transform; no hidden reflection |
| 4 | Embedded Postgres for dev and tests | `npm run dev` / `npm test` work on a clean machine; tests use real SQL semantics (unique indexes, row locks) |
| 5 | npm workspaces, source-exported internal packages | No build step between packages; one TypeScript config base |
| 6 | Accepted hard-constraint codes are explicit and logged | "Never relax a must-have without approval" (spec §4, D01) |
| 7 | 404 for non-members | Avoids leaking plan existence |
| 8 | Travel time labeled `estimate`, from coordinates when known | Trust by design until a routing service exists |
| 9 | Google Gemini (`gemini-3.5-flash-lite` by default) | The owner's priority is lowest cost. 2.5 Flash-Lite (free grounding) is closed to keys created since late 2026, so the default is Google's current stable Flash-Lite: free for plain calls, grounding with billing (5,000 a month free). Without billing, answers fall back to unchecked and say so. One interface keeps other providers a one-file change |
| 10 | Deterministic TypeScript planner instead of an LLM or a Python/OR-Tools worker (for now) | Exact for realistic plan sizes, runs in the browser's language, shares the validator, testable; no second runtime. Revisit for multi-day trips with many stops |
| 11 | AI answers private until shared; viewers can't spend AI | The product decision from the spec discussion; also keeps cost with editors |
| 12 | Servers listen on 127.0.0.1 unless `BIND_HOST` says otherwise; in phone mode other devices need a 6-digit code to sign in | The dev sign-in has no password; other devices on the network shouldn't reach it by accident, and opening it to a phone shouldn't open it to everyone on the same Wi-Fi |
| 13 | Google Maps checks deferred to a later update; Orbit runs on Gemini's free tier for now (November 9, 2026) | Lowest cost while Orbit is in development. The grounding path and the unchecked fallback are already built, so billing on the key turns checks on without a code change. Until then answers are labeled “Not checked”, and real users' data shouldn't go through the free tier, which Google may use to improve its products |
| 14 | Phone access over the local network as a home-screen web app (November 9, 2026), not a native app or a public tunnel | The phone layout already exists; a manifest and icons make it an app icon with no app store, Xcode or Android Studio. A tunnel would put the passwordless dev sign-in on the internet. Away-from-home use waits for a real deployment with HTTPS and real sign-in |
| 15 | The computer layout needs a window at least 768 × 512 px (`desk:` variant in `globals.css`, `DESKTOP_LAYOUT` in the workspace) | A phone turned sideways is wide but only about 390 px tall: with the rail, sidebar and header the plan got a sliver of the screen. Width and height together keep phones on the phone layout and tablets and laptops on the canvas |
| 16 | Invite tokens stored only as SHA-256 hashes; the full link is shown once (and again only on the device that made it) | The token is the whole secret (192 bits). A leaked database or backup shouldn't contain working links. Making a new link takes one tap, so not being able to show an old one costs little |
| 17 | A link never changes the role of someone already in the plan, and links stop working when their creator can no longer invite | Otherwise an editor made a viewer could promote themselves with their own old link, and a removed member could walk back in. Role changes happen in one place: the owner's People list |
| 18 | Live updates for SQL data as content-free hints over the existing Yjs socket, sent by the browser; the data itself over HTTP | No second socket, no second permission system, works for viewers. Trade-off: a hint is lost if the tab closes right after a change (the slow refetch covers it), and clients could send pointless hints (whitelisted, rate-limited, harmless). When the API runs as more than one instance, it should publish these events (for example through Redis or the realtime server's HTTP hook) instead |
| 19 | Invites work on the same Wi-Fi for now; invites for people anywhere wait for deployment and real sign-in (November 9, 2026) | The development sign-in has no password: with the phone code, a device can sign in as anyone. That's fine for your own phone and friends sitting with you, not for links sent over the internet. Deployment with HTTPS and Google sign-in is the prerequisite |
| 20 | The free canvas (text, stickers, photo placement, arrows) lives in the plan's Yjs document, next to card layout; ideas stay SQL (November 10, 2026) | It's whiteboard content: it should merge and move live like layout, and it needs no server rules beyond what readers check. Anything that needs comments, votes or a place in the itinerary is still a card. Kept on React Flow (MIT, already in use) rather than a whiteboard SDK, so cards stay real React components and nothing adds a license cost |
| 21 | Photos: shrunk in the browser, re-encoded on the server with sharp (WebP, ≤2048 px, metadata dropped), stored as files with a SQL row, and served only through signed links | Re-encoding on the server is the only way to be sure a GPS location or a disguised file never reaches the group. Signed links because `<img>` can't send the session header, and presigned object-storage links work the same way later |
| 22 | Photo files on local disk for now, behind `PhotoStorage`; a deployment uses a persistent disk or object storage | Lowest cost while Orbit is in development. Object storage with a free tier and no egress fees (for example Cloudflare R2) is the likely choice for the deployment; only the storage class changes |
| 23 | Photos taken off the board are kept until a cleanup job exists | ⌘Z must be able to bring a photo back, and the API can't see the Yjs document's references without reading it. The per-plan limit (300) bounds what's kept meanwhile |
