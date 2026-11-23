# StayX POS + KMS — Audit against the HSM + POS + KMS spec

Originally audited: `pos/` at commit `a748f97`, 2026-10-25. HAIP read at `cb8d140`, read-only.
Last updated 2026-11-22: HAIP at `439956d` (§14). POS code unchanged since UI merge `9c6e07b` (2026-11-05). §9 and §10 are dated run records and keep the versions they ran on.
Spec: `../HSM+POS+KMS.pdf` (the brief said `./docs/HSM_POS_KMS.pdf`; no `docs/` folder exists).
Method: code reading with `file:line` evidence. Nothing was run, migrated, installed or started for the original audit.
"Verified" below means "read in code", unless it points to the live runs in §9 and §10.

---

## Summary

- **The order pipeline is solid.** Spec steps 2–4 are done: server-side pricing, a live kitchen board, guarded status changes, and an outbox row written in the same DB transaction as "delivered". Step 5's posting machinery is done too (unique key, retries with backoff, terminal states, sweeper, manual retry/resolve API). All of it is unit-tested, and the in-house charge path has run against real local HAIP (§9).
- **Biggest gap: no authentication or roles anywhere in POS/KMS** (API, WebSocket, both UIs). This breaks the spec rule "do not leave the POS without authentication" and blocks tasks 3, 4, 7, 9 and 11.
- **Biggest correctness risk: charges are routed by room number at posting time, not by stay.** HAIP's `folio-inbound` looks up whoever is in that room *when the charge arrives*. A retry or sweeper post that lands after a checkout, room move or re-letting either fails (400) or **posts to the wrong guest's folio** (confirmed live, §9 S6c). POS never captures the stay or folio at order time. The Retry guard stops re-sends of rejected rows, but a late first post can still reach the wrong guest.
- **Step 2 of the spec ("validate room against an active stay") is missing in POS.** Any room string up to 20 characters is accepted when the order is placed. Validation happens only implicitly, inside HAIP, at posting time.
- **Duplicate charges are prevented, but retries can end ambiguous.** Each order has a deterministic key (`stayx-rs-<orderId>`), and HAIP's unique index stops double charges. But HAIP answers a repeated key with **500** instead of the existing charge (confirmed earlier on real Postgres). So "response lost, then retry" ends as `failed` with a manual "verify the folio" step.
- **Tax works once HAIP has a rule. Currency and reconciliation are still open.**
  - POS sends a pre-tax subtotal (correct for HAIP), but the demo HAIP has **no tax rule for `food_beverage`**, so tax is 0 by default. A temporary 12% rule posted correctly (§10).
  - Neither side checks that the order currency matches the folio currency.
  - There's no reconciliation job, and HAIP emits no webhook for folio-inbound charges.
- **No support for cancellations or refunds after delivery, room moves, or checkout races.** `delivered` is final, and reversing a HAIP charge needs a staff JWT that POS doesn't have.
- **Not production-ready:**
  - Swagger is always on and there's no rate limiting or health endpoint.
  - The database uses dev credentials.
  - There's no API Dockerfile, backups or monitoring.

---

## 1. Codebase map (`pos/`)

| Area | What's there | Evidence |
|---|---|---|
| Stack | pnpm monorepo. NestJS 12 API (ESM, TS strict), Drizzle ORM + Postgres 16, BullMQ 5 + Redis 7, Socket.IO, React 19 + Vite + Tailwind 4 front ends, Vitest | `package.json`, `apps/*/package.json` |
| DB schema | 4 tables: `menu_items`, `orders`, `order_items` (name/price snapshots), `haip_post_outbox`. Enums `order_status`, `outbox_status`. `property_id` on every table (plain UUID, no FK/property table) | `packages/database/src/schema/*.ts`, `migrations/0000_kind_karen_page.sql:1-69` |
| Migrations | drizzle-kit, single migration 0000, applied by `pnpm db:migrate` | `packages/database/drizzle.config.ts` |
| HTTP API (prefix `/api/v1`) | `POST/GET /menu-items`, `PATCH /menu-items/:id`; `POST/GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`; `GET /outbox`, `POST /outbox/:id/retry`, `POST /outbox/:id/resolve`; `GET /` (Nest boilerplate) | `menu.controller.ts:11-25`, `orders.controller.ts:11-35`, `outbox.controller.ts:11-32`, `app.controller.ts:8` |
| Validation | Global `ValidationPipe {whitelist, forbidNonWhitelisted, transform}`; money as 2-dp strings | `main.ts`, `common/is-money-string.validator.ts` |
| Auth | **None.** No guards, JWT, API keys or roles anywhere in `apps/api/src` | grep for `UseGuards/CanActivate/AuthGuard/@Roles/jwt` → 0 hits |
| Realtime (KMS) | Socket.IO gateway, `joinProperty`/`leaveProperty` with UUID check; server emits `order.created` (with items) / `order.status_changed` (row) to `property:<id>` room only, after commit | `events/kitchen.gateway.ts:32-60`, `events/order-events.service.ts` |
| Worker / queue | BullMQ queue `haip-post-outbox`, 5 attempts, exponential backoff from 15 s, jobId = outbox id; worker concurrency 2; sweeper every 60 s | `haip/haip-queue.service.ts:6-24,47`, `haip/outbox.worker.ts:11,50,56,71` |
| HAIP client | `POST {HAIP_API_URL}/folio-inbound/charges`, `x-api-key`, 10 s timeout, never throws, redacts key | `haip/haip-client.ts:15,34-43,88` |
| Config | `pos/.env` via `process.loadEnvFile`; `HAIP_API_URL/KEY/PROPERTY_ID/TIMEZONE`, `REDIS_URL`, `DATABASE_URL`, `CORS_ORIGINS`, `PORT`; bridge disabled without key | `load-env.ts`, `haip/haip.config.ts:35-48`, `.env.example` |
| Front ends | `apps/pos` (order entry, cart, recent orders, menu admin), `apps/kms` (4-column board, status buttons, sound). Both plain fetch + socket.io-client, styled through `packages/ui` (§12); property from `?propertyId=` or `VITE_DEFAULT_PROPERTY_ID` | `apps/pos/src/App.tsx`, `apps/kms/src/App.tsx`, `apps/*/src/config.ts` |
| Tests | 23 spec files, all unit tests with mocked DB/fetch/queue (API 113, POS 46, KMS 28, UI 5 on 2026-11-05). No automated DB-backed or HAIP-backed tests in repo; the manual live runs are in `scripts/live-run*.mjs`. `apps/api/test/app.e2e-spec.ts` is Nest boilerplate (`GET /` → "Hello World!") | `git ls-files '*.spec.ts'`, `apps/api/test/app.e2e-spec.ts:21-23` |
| Not covered by tests | `menu.service`, `haip.config`, controllers, gateway auth, React components (§7 item 20) | absence of spec files |

---

## 2. Workflow trace (spec §2)

| # | Step | Status | Files | Gaps |
|---|---|---|---|---|
| 1 | Guest checks in (HAIP) | HAIP-owned; POS not involved | — | POS doesn't subscribe to HAIP's `reservation.checked_in/checked_out/room_moved` events, so it has no stay context |
| 2 | Restaurant creates order; POS prices on backend | **Partial** | `orders.service.ts:46-60,64-69` (one transaction), `order-pricing.ts:41-78` (decimal.js, rejects unknown/unavailable/mixed currency), `dto/order.dto.ts:50-51` | **No room/stay validation** (any ≤20-char string). No capture of HAIP reservation/folio. No auth or user attribution (`placedBy` is free text, `dto/order.dto.ts:70-71`) |
| 3 | Kitchen prepares; KMS live | **Done** | `order-status.ts:9-16` (forward-only), `orders.service.ts:132-158` (optimistic concurrency → 409), `order-events.service.ts` (emit after commit), `apps/kms/src/useKitchen.ts`, `apps/kms/src/api.ts:44-45` (status via `PATCH` API only) | No auth on socket or PATCH. Any client can join any property room and read all orders (room numbers, notes) |
| 4 | Delivered → hotel-charge task in same transaction | **Done** | `orders.service.ts:161-170` (outbox insert inside `db.transaction`, `onConflictDoNothing` on `(property_id, vendor_txn_id)`), enqueue after commit `:181`, `outbox.ts` unique index (`migration:68`) | None on POS side |
| 5 | Worker validates and posts; retries safely | **Partial** | `outbox.processor.ts:48-119`, `charge-mapper.ts:29,45-77`, `haip-client.ts`, `outbox.worker.ts:56-88` | "Validates room/stay": only the property check (`processor.ts:50`). Room/stay validity is left to HAIP. Posting is by room number, so it's **wrong-guest prone** on late retries. Duplicate-retry 500 is ambiguous (HAIP bug). No max-age guard. The Retry guard blocks re-sends of rows rejected as having no in-house guest |
| 6 | HAIP updates folio with tax | **Verified against real HAIP** (§9 S1, S7c; §10 Re-test) | Contract read in HAIP: `folio-inbound.service.ts:19-100`, `folio.service.ts:712-820` | Tax only if a HAIP tax rule targets `food_beverage` (none seeded). The ≥10% overflow is fixed by HAIP migration 0030. Currency not checked by either side |
| 7 | Checkout settles folio incl. restaurant charges | HAIP-owned; **risk on POS side** | HAIP `reservation.service.ts` ~L787: checkout requires zero balance on open folios | Charges still pending in POS at checkout won't land (after checkout, folio-inbound → 400 → `needs_attention`). POS can't warn the front desk, and HAIP can't see pending POS charges |

---

## 3. Data ownership (spec §4), POS side

| Rule | Finding | Evidence |
|---|---|---|
| No POS room inventory | ✅ None. `orders.room_number` is a free-text reference only | `schema/orders.ts`; no rooms table; grep for room/guest/reservation entities → none |
| No POS guest records / reservation logic | ✅ None | same grep: only comments in `haip/*` mention folios |
| POS references HAIP property IDs | ⚠ **Partial.** `property_id` is any client-supplied UUID with no mapping table and no check that it's a HAIP property. Only one HAIP property is supported, via env `HAIP_PROPERTY_ID`. Other properties' rows go to `needs_attention` | `haip.config.ts:45`, `outbox.processor.ts:50-51` |
| POS validates room against an active HAIP stay | ❌ **Missing** at order time and in the worker (delegated implicitly to HAIP at post time) | `dto/order.dto.ts:50-51`, `outbox.processor.ts:48-69` |
| POS owns menu, prices, orders, lines, kitchen status, outbox | ✅ All in POS DB with snapshots | `schema/*.ts`, `order_items` name/unit_price snapshot |
| KMS status changes via POS backend | ✅ KMS calls `PATCH /orders/:id/status`; no direct DB access from front ends | `apps/kms/src/api.ts:44-45`, `useKitchen.ts:106-110` |
| Users and permissions (shared identity, no unauthenticated POS) | ❌ **Violated.** No auth at all | §1 Auth row |

No data-duplication violations were found. The two ownership problems are a **missing check** (stay validation) and a **missing control** (auth).

---

## 4. The 13 tasks (spec §5)

| # | Task | Owner | Real status | Evidence | Next action (POS/KMS) | Depends on HAIP |
|---|---|---|---|---|---|---|
| 1 | Connect delivered order to an actual HAIP folio | Shared | **Partial** | Outbox and worker post to `folio-inbound` (`haip-client.ts:34`); verified against real local HAIP for in-house guests (§9 S1) | Capture the stay at order time; post to the folio of *that* stay | Stay/folio lookup readable with the API key; idempotent post by folio or reservation (see §6) |
| 2 | Validate room, property, active stay | POS (+HAIP data) | **Missing** | `dto/order.dto.ts:50-51` accepts any string | Validate on `POST /orders` (and re-check in the worker before posting); store `haipReservationId`/`haipFolioId` on the order | An API-key endpoint "active stay by room" (doesn't exist), or webhooks with room numbers |
| 3 | Login across HMS, POS, KMS | Shared | **Missing in POS/KMS** | No guards in API, no login in `apps/pos`/`apps/kms` | Validate HAIP's Keycloak JWTs in the API (JWKS, `iss`, `aud`); log in from both UIs (OIDC PKCE); authenticate the socket handshake | Keycloak realm needs a POS client, audience mapper and a `property_ids` claim; HAIP realm currently has neither mapper |
| 4 | Role-based permissions | Shared | **Missing in POS** | No role checks anywhere | Roles: restaurant staff (orders, menu read), kitchen (status only), manager (menu edit, outbox, reports), admin; enforce per route and per socket event | Agree role names in Keycloak (HAIP has `admin`, `front_desk`, … but no restaurant/kitchen roles) |
| 5 | Prevent duplicates; handle failures safely | Shared | **Done (POS side)**; HAIP side buggy | Deterministic key `charge-mapper.ts:29`; outbox in same transaction `orders.service.ts:161-170`; retry/terminal/final logic `outbox.processor.ts:73-119`; status-guarded writes `:136`; sweeper `outbox.worker.ts:71` | Add a max-age/stay guard before auto-posting; surface `failed` rows in a UI | HAIP must return the existing charge (200) for a repeated `vendorTxnId` instead of 500 |
| 6 | Tax, currency, reconciliation | Shared | **Partial** (tax verified live, §10; currency and reconciliation open) | Pre-tax amount `charge-mapper.ts:53`; currency free per menu item (`menu-item.dto`); `haipChargeId` stored on success | Check order currency = HAIP property currency (available via `GET /connect/properties/:id`); nightly reconciliation of `posted` rows against the HAIP folio | A `food_beverage` tax rule on the property; folio-inbound should emit `folio.charge_posted`; an API-key read of charges by `vendorTxnId` |
| 7 | One branded entry point and shared navigation | Shared | **Partial** (shared look only) | Two separate apps on :5180 (POS) and :5181 (KMS). They share a HAIP-style shell through `packages/ui` (§12), but there's no single entry point | After auth: one launcher that routes by role (POS / Kitchen / Overview) | Shared login (task 3) |
| 8 | Property mapping HMS ↔ POS | Shared | **Partial** | Single env `HAIP_PROPERTY_ID` (`haip.config.ts:45`); POS `property_id` unvalidated | Add a `properties` mapping table (POS property → HAIP property + key reference + currency + timezone) and validate `propertyId` on every request | Per-property API keys (exist: `/admin/connect/credentials`) |
| 9 | Integration-status / error screen | POS | **Partial (API only)** | `GET /outbox`, `retry`, `resolve` exist (`outbox.controller.ts`); no UI in `apps/pos` | Add an "Outbox" tab: filters, `lastError`, retry/resolve with a "verify folio first" warning for `failed` | — |
| 10 | Consolidated hotel + restaurant reports | Shared | **Missing** | No report endpoints in POS | Add POS sales and posting reports (by day, outlet, status) as an API for a shared Overview | HAIP reporting integration point |
| 11 | Centralized user and property admin | Shared | **Missing in POS** | No users/properties in POS | Consume the shared identity; property mapping admin (task 8) | Identity provider ownership decision |
| 12 | Test refunds, cancellations, room moves, checkout, network failures | Shared | **Mostly missing** | Unit tests cover network/5xx/timeout classification (`haip-client.spec.ts`, `outbox.processor.spec.ts`); `scripts/live-run*.mjs` ran room moves, checkout and re-letting against local HAIP (§9); **no code paths** for refunds/voids or room moves | Write the missing flows first (see §5), then a committed integration suite against a fake HAIP. The scripted local HAIP run already exists | HAIP test data; reversal endpoint usable by POS |
| 13 | Secure deployment, secrets, backups, monitoring | Shared | **Not done** | Swagger always on (`main.ts:31`); no rate limit/health; dev DB creds in compose and default URL (`database.module.ts:11`); key redacted in logs (`haip-client.ts:88`) | Gate Swagger; `/health`; rate limiting; secrets from a manager; DB backups; metrics/alerts on outbox `failed`/`needs_attention` count and queue depth; API Dockerfile | — |

---

## 5. High-risk checks

### 5.1 Idempotency and failure handling
- **Unique key per charge:** yes. `vendorTxnId = "stayx-rs-" + order.id` (`charge-mapper.ts:29`), stored once in `haip_post_outbox`, unique on `(property_id, vendor_txn_id)` (`migration:68`).
- **Outbox in the same transaction as "delivered":** yes (`orders.service.ts:133-170`). Enqueueing happens after commit and isn't awaited (`:181`), so a Redis outage can't fail the request; the sweeper recovers it (`outbox.worker.ts:71`).
- **Repeated "delivered":** impossible, because `delivered` is final (`order-status.ts:14`) and the insert is `onConflictDoNothing`.
- **Timeout / 5xx / 429 / network error:** retried, 5 attempts total, 15 s → 30 s → 60 s → 120 s (`haip-queue.service.ts:8-9`, `outbox.processor.ts:97-119`). On the final attempt the row goes to `failed` with "May already be posted in HAIP, verify the folio before retrying".
- **400/401/403/404/422:** `needs_attention` immediately, with HAIP's message (`charge-mapper.ts:72-77`, `processor.ts:85-95`).
- **Concurrent staff action:** worker and staff writes only apply to `pending` or actionable rows (`processor.ts:136`, `outbox.service.ts:65`).
- **Residual risks:**
  1. **HAIP duplicate-key bug.** A lost response followed by retries ends as `failed` and needs a human. This is HAIP-side.
  2. **Wrong-guest posting.** A late retry or sweeper post goes to whoever occupies the room *now* (HAIP `folio-inbound.service.ts:52-80`). Confirmed live (§9 S6c). There's no max-age check and no stay identity, and the Retry guard only covers re-sends of rejected rows.
  3. **No alerting** on `failed`/`needs_attention`. They're only visible via `GET /outbox`.

### 5.2 Tax, currency, rounding
- **POS:** line totals and the subtotal are computed with decimal.js at 2 dp (`order-pricing.ts:71-78`). The amount sent is the pre-tax subtotal (`charge-mapper.ts:53`), which matches HAIP: HAIP adds tax itself as child `type:'tax'` rows (`folio.service.ts:787-807`).
- **HAIP tax only applies if** the property's active tax profile has a rule for `food_beverage`. The demo seed has none, so tax = 0.
  - The demo property has **two active profiles** and the pick is non-deterministic (see `../HAIP_INSIGHTS.md`).
  - Rates of 10% or more overflowed `charges.tax_rate numeric(5,4)` (confirmed, §9 S7a). HAIP migration 0030 fixed this, and 12% was verified live (§10).
- **Currency:** POS allows any 3-character currency per menu item. HAIP `postCharge` does not compare the charge currency to the folio currency (0 matches in `postCharge`). **A wrong-currency charge would be summed into the balance.** POS should enforce the property currency.
- **Service date:** delivery time converted to a calendar date in `HAIP_TIMEZONE` (`charge-mapper.ts:58`). That's correct only if the env matches the HAIP property's timezone (available via `GET /connect/properties/:id`).

### 5.3 Cancellations, refunds, room moves, checked-out stays
- **Cancel before delivery:** allowed from placed/accepted/preparing (`order-status.ts:10-12`). No charge is created.
- **Cancel or refund after delivery:** **impossible in POS** (`delivered: []`). Reversing the HAIP charge needs `POST /folios/:id/charges/:chargeId/reverse` with a staff JWT and `folios.manage` (HAIP `folio.controller.ts:156-157`). POS has neither.
- **Room move between order and post:** **not handled.** The charge goes to the room number, so either 400 (`needs_attention`) or the next occupant.
- **Order on an already checked-out stay:** HAIP returns 400 (no in-house reservation) and the row becomes `needs_attention`. But the order was still accepted and cooked, because POS never checked the stay at order time.
- **Checkout with charges still pending in POS:** HAIP requires a zero balance at checkout. A charge posted after checkout fails. Nothing warns the front desk.

### 5.4 Auth and roles
- **No authentication** on any HTTP route (`menu`, `orders`, `outbox` controllers), on the WebSocket (`kitchen.gateway.ts:32`: "No auth yet"), or in either UI.
- **No roles.** Anyone can edit prices, change any order's status, resolve outbox rows (marking charges "posted" without sending them), or subscribe to a property's live orders.
- The only protection is CORS (`common/cors.ts:2`), which doesn't stop non-browser clients.

---

## 6. HAIP integration contract

What POS uses today:

| Purpose | HAIP endpoint | Auth | Payload / notes |
|---|---|---|---|
| Post restaurant charge | `POST /api/v1/folio-inbound/charges` | `x-api-key: ck_live_…` (property-scoped key from `connect_credentials`) | `{ roomNumber, type, amount, currencyCode, vendorTxnId, description?, serviceDate? }`, no `propertyId` (from key). Resolves room → reservation in `checked_in/stayover/due_out` → `guest` folio (`folio-inbound.service.ts:19-100`). 201 returns the charge row. Duplicate `vendorTxnId` → **500** (bug). Returns 403 when HAIP runs with `AUTH_ENABLED=false` (`folio-inbound.controller.ts:29-30`) |

POS's request matches this contract exactly (`charge-mapper.ts:45-59`, `haip-client.ts:34-43`).

What POS needs but can't get today:

| Need | Closest HAIP option | Problem |
|---|---|---|
| Validate an active stay for a room at order time | None readable with an API key. Staff REST `GET /reservations` has no room filter; `GET /rooms` needs a JWT | No way to validate with the POS's credential |
| Post to a specific stay/folio | `POST /api/v1/pos/charges` (`folioId`, `x-api-key`) | No idempotency (`reference` only goes into the description); POS would need the `folioId` first |
| Keep stay context without polling | Connect webhooks `POST /api/v1/connect/subscriptions`: `reservation.checked_in` (`roomId`, `folioId`), `reservation.room_moved` (`newRoomId`), `reservation.checked_out`, `room.status_changed` (`roomNumber`) | Room *number* isn't in the check-in payload. Folio-inbound charges emit **no** `folio.charge_posted` (`folio.service.ts:820` skips when given a transaction; `folio-inbound.service.ts:89-100` passes one) |
| Property currency and timezone | `GET /api/v1/connect/properties/:id` (key) returns `currencyCode`, `timezone` (`connect-content.service.ts:48-49`) | Usable today, but POS doesn't call it |
| Reverse a charge (refund/void) | `POST /api/v1/folios/:id/charges/:chargeId/reverse` | Needs a staff JWT + `folios.manage`; no API-key path |
| Verify a charge landed (reconciliation) | `GET /api/v1/folios/:id/charges` | Needs a JWT; no lookup by `vendorTxnId` |
| Get a key on a fresh HAIP database | `POST /api/v1/admin/connect/credentials` | Returns 500 on fresh databases: `connect_credentials` is missing from HAIP's `push-schema.ts` and migration 0002 is never run (`migration-runner.ts:15`). Local workaround: `../haip-local-fixes/001_connect_credentials.sql` |

---

## 7. Prioritised TODO (POS/KMS only)

**A. Blocks a correct integration**
1. **Capture the stay at order time** (L): on `POST /orders`, resolve room → active reservation and folio via HAIP; store `haip_reservation_id` and `haip_folio_id` on the order (new migration); reject if there's no active stay. Depends on a HAIP lookup (§8 Q1).
2. **Post to that stay, not the room** (M): the worker must re-check the stay is still in-house before posting, and target the stored folio. Otherwise mark `needs_attention` ("guest checked out / moved"). Depends on HAIP Q2.
3. **Max-age guard on auto-posting** (S): don't auto-post rows older than N hours, or after a `checked_out` or `room_moved` event; park them for a human.
4. **Property mapping table** (M): POS property → HAIP property, key reference, currency, timezone. Validate `propertyId` on every request. Read currency and timezone from `GET /connect/properties/:id`. Removes the single `HAIP_PROPERTY_ID` env.
5. **Currency enforcement** (S): menu items and orders must use the mapped property currency.
6. **Run once against real local HAIP: done** (§9, §10). Scripts are in `scripts/`.

**B. Security**
7. **API authentication** (M): validate HAIP Keycloak JWTs (JWKS, `iss`, `aud`, `azp`) with a global guard and `@Public()` only for health.
8. **Role guard** (M): restaurant staff / kitchen / manager / admin, mapped per route. `outbox/resolve` and menu edits for manager+ only.
9. **Socket auth** (S): require the JWT on the handshake; check property membership on `joinProperty`.
10. **UI login** (M): OIDC PKCE in `apps/pos` and `apps/kms`, sending the bearer token on fetch and the socket.
   - **Must happen before production because of the guest lookup (added 2026-11-22, Phase 1 step 4):** `GET /api/v1/stays/lookup` returns in-house guests' first names and surname initials by room, and it is unauthenticated like the rest of the API. Anyone who can reach the API could walk room numbers to list guests. Items 7–10 must put it behind staff login (and item 8 limit it to restaurant staff).
   - **Stopgap only:** a per-IP limit of 30 lookups per minute (`STAY_LOOKUP_RATE_LIMIT_MAX`, `..._WINDOW_MS`). Counts are in memory and per process, and keyed by the socket address, so behind a proxy all clients share one limit.
   - **Same exposure on the kitchen socket:** order payloads now include `verifiedGuestName` (for example "Ada L."), and the socket has no auth either (item 9).
11. **Hardening** (S): gate Swagger outside dev, rate limiting, `/health`, no default DB credentials outside dev.

**C. Correctness**
12. **Void/refund after delivery** (L): a POS "void" state and an outbox action that asks HAIP to reverse the posted charge. Needs a HAIP endpoint POS can call (Q4).
13. **Outbox screen in `apps/pos`** (M): list, filter, `lastError`, retry/resolve with a "verify folio first" warning for `failed`.
14. **Reconciliation job** (M): daily compare of `posted` rows against HAIP folio charges (needs HAIP Q5); alert on mismatches.
15. **Alerts** (S): log or metric when `failed`/`needs_attention` rows appear; queue depth.
16. **Tests** (M): `haip.config`; a committed fake-HAIP integration test; replace the boilerplate `app.e2e-spec.ts`.

**D. Nice to have**
17. Role-based launcher / single entry point (M, after auth).
18. POS sales and posting reports API for the shared Overview (M).
19. API Dockerfile, backups and monitoring runbook (M).
20. **Frontend component tests** (M): set up `jsdom` and Testing Library (new dev packages, not installed yet). First test: a sticky toast stays until dismissed. A POS success toast disappeared once in a scripted browser run on 2026-11-05. It didn't happen again in three further runs and is assumed to be an outside click on that browser.
21. **Test KMS on a real kitchen tablet** (S): readability, beep volume, and how many tickets fit per column.
22. **Compact ticket mode** (M, if needed): consider it if a busy kitchen scrolls too much. About two tickets fit per column at 1024×768.
23. **Migrate `stayx_pos_live` before the next live run** (S): it has only migration `0000`, so the API's queries on the Phase 1 columns fail against it. Back it up first. The live-run scripts now send `unverified: true` and expect `HAIP_STAY_LOOKUP` unset.
24. **The POS service principal can read guest phone numbers** (added 2026-11-23, Phase 1 step 7; ties to HAIP request R8 in `INTEGRATION_DESIGN.md` §5.2).
   - **The grant:** `HAIP_STAY_LOOKUP=haip` uses a service principal linked with `reservations.read` and `folios.read` only (decided 2026-11-23). `guests.read` was left out: the adapter never needs it, and it would let the credential call `GET /guests/:id` and `GET /guests?search=`, which return phone and email.
   - **It still reaches phones without `guests.read`:** HAIP's read routes have no permission check today, so any linked principal for the property can call `/guests` anyway. `GET /reservations/:id`, which the adapter calls, also returns the full guest record with phone and email.
   - **What POS does with it:** the adapter (`apps/api/src/haip/haip-stay-lookup.ts`) keeps only first name, surname initial, status, room, departure and folio id. It never logs or stores a response body, and it never calls `/guests`. Tests check that phone and email don't come out.
   - **Still to do:** keep the secret out of git and logs; ask HAIP for R8 (permission checks on read routes) and R1/R2 (a lookup that never returns contact details).

---

## 8. Open questions for the HAIP side

1. **Stay lookup for POS:** can HAIP add an API-key endpoint such as `GET /folio-inbound/stays?roomNumber=` that returns `{ reservationId, folioId, guestName?, departureDate }` for the in-house stay? Without it, POS can't do spec step 2.
2. **Idempotent post by stay:** can `POST /folio-inbound/charges` accept an optional `reservationId` or `folioId` (and reject if that stay is no longer in-house)? Or can `POST /pos/charges` take a `vendorTxnId` with the same unique-index protection?
3. **Duplicate `vendorTxnId`:** will HAIP fix the duplicate path to return the existing charge (200/201) instead of 500? The insert error aborts the transaction, so the follow-up SELECT fails with `25P02`.
4. **Reversal:** can a POS key reverse a charge it posted (by `vendorTxnId`), or must refunds go through front-desk staff?
5. **Reconciliation:** will folio-inbound emit `folio.charge_posted`? Can a key read a charge by `vendorTxnId`?
6. **Tax:** which tax rule should apply to restaurant charges? Which of the demo property's two active tax profiles is meant to be active? (Rates of 10% or more now work after HAIP migration 0030.)
7. **Currency:** should HAIP reject a charge whose currency differs from the folio's?
8. **Checkout:** should HAIP warn or block checkout when the POS has unposted charges for the stay (via a POS endpoint or webhook), or is that a front-desk process?
9. **Identity:** will the shared Keycloak realm get POS/kitchen roles, an audience mapper for the POS API and a `property_ids` claim? Who owns user admin (task 11)?
10. **Fresh installs:** will `connect_credentials` be restored to HAIP's `push-schema.ts`, so keys can be created on a new database?

---

## 9. Live run results

Run on 2026-10-25 against **real local HAIP** (`haip` at `cb8d140`, Docker image `haip-api` built from that commit). No HAIP code was changed.

### Setup

- **HAIP, auth off (`:3000`).** The stock `docker compose up api` (`AUTH_ENABLED=false`), used only for front-desk and admin actions: creating the API key, tax rules, room move, check-out, check-in.
- **HAIP, auth on (`:3001`).** A second container from the same image with `AUTH_ENABLED=true` and no Keycloak, shared DB and Redis. **POS posted only to this one**, because folio-inbound needs a property-scoped key, which only works with auth on (probe below).
- **POS API (`:4100`).** Built from the current tree and pointed at a **scratch database `stayx_pos_live`** (new DB in the POS Postgres container, migration 0000 applied) and Redis DB 1.
  - **Why the scratch DB:** the demo DB `stayx_pos` has 3 old `pending` outbox rows (from 2026-10-07/10). The sweeper would have posted those to real HAIP folios. `stayx_pos` was not touched.
- **API key.** A temporary property-scoped Connect key was created through HAIP's admin API, held only in memory (never printed or written), and **revoked** at the end. A post with it afterwards returned 401, and the key does not appear in the POS logs.
- **Test data.** HAIP demo property TGH (`a0000001-…0001`, USD, America/New_York); one POS menu item at 20.00 USD.
- **Run scripts:** `scripts/live-run.mjs` and `scripts/live-run-relet.mjs`.

### Results

| # | Scenario | What happened | Result |
|---|---|---|---|
| 0 | Folio-inbound access | No key on the auth-on instance → **401** "Invalid or missing API key". Auth-off instance → **403** "folio inbound requires a property-scoped API key". `GET /connect/properties/:id` with the key → 200, `currencyCode: USD`, `timezone: America/New_York` | Confirms §6: needs `AUTH_ENABLED=true` + key. Currency and timezone are readable with the POS key |
| S1 | **Normal charge**, room 202 (in-house, Elena Petrova) | POS outbox `posted` on attempt 1, `haipChargeId` stored. HAIP has one `food_beverage` 20.00 charge on her guest folio `f2000001-…0007`, description "Room service RS-261025-YNM3 (1 item lines)". No tax row (no `food_beverage` rule yet) | ✅ Works end to end. Tax = 0 with seed data, as predicted |
| S2a | **Duplicate `vendorTxnId`**, replayed directly to HAIP | HAIP **500** "Internal server error". HAIP log: unhandled `duplicate key value violates unique constraint "folio_inbound_posts_property_vendor_unique"`. Still exactly 1 `folio_inbound_posts` row and 1 charge | ⚠ **No double charge, but a 500 instead of the existing charge.** Confirms Q3. The log shows the original `23505` rather than `25P02`; the dedupe branch runs inside an already-failed transaction either way |
| S2b | **Duplicate via POS retry** ("response lost" simulation: S1 row forced to `failed`, then `POST /outbox/:id/retry`) | POS re-posted the same key 5 times over ~4 min (15 s → 30 s → 60 s → 120 s), got 500 each time, and parked the row as `failed`: "May already be posted in HAIP, verify the folio before retrying. Last error: HTTP 500". HAIP still has 1 charge | ⚠ Safe, but always ends with a human checking the folio. (`haipChargeId` on this row is left over from S1; the simulation only changed `status`) |
| S3 | **Vacant room** 108 | HAIP 400 "Room 108 is vacant or has no in-house reservation". POS `needs_attention` on attempt 1. Nothing stored in HAIP | ✅ Correct classification. ❌ The order was still taken and cooked (no check at order time) |
| S4 | **Room whose stay is checked out** (203, only a `checked_out` reservation) | Same 400 → `needs_attention`. Nothing stored in HAIP | Same as S3 |
| S5 | **Room move before delivery**: order for 202, guest moved 202 → 205 (HAIP move-room 200), then delivered | HAIP 400 "Room 202 is vacant…" → `needs_attention` | ❌ **The charge doesn't follow the guest.** Revenue is parked until a human acts |
| S6a | **Checkout race**: order for room 110 (Maria Garcia, folio balance 0.00), HAIP check-out succeeded (200) while the order was `ready`, then delivered | HAIP 400 "Room 110 is vacant…" → `needs_attention` | ❌ **HAIP let the guest check out with an unposted POS charge**, and the charge can no longer reach her folio (it's closed) |
| S6b+c | **Re-let, then staff Retry**: room 110 cleaned (`vacant_dirty → clean → vacant_clean`), reservation `…0011` (Sarah Johnson) assigned and checked in, then staff pressed **Retry** on the parked S6 row | POS row → `posted`. HAIP charge `7fa6461e-…` (food_beverage 20.00) is on **Sarah Johnson's folio** (reservation `…0011`). The order was for Maria Garcia | ❌ **Confirmed: charge posted to the wrong guest.** The retry button and the sweeper both post by room number at post time (§5.1 risk 2). This is the top integration risk |
| S7a | **12% `food_beverage` tax**: rule `LIVE_FB` (percentage, 12.0000, `food_beverage`) added via `POST /tax/profiles/:id/rules` to **both** active TGH profiles (avoids the profile-pick ambiguity). `POST /tax/calculate` preview → 2.40 on 20.00. Then a direct post to room 210 | HAIP **500**. HAIP log: `numeric field overflow`. The whole transaction rolled back, so no `folio_inbound_posts` row and no charge | ❌ **Confirmed: any tax rate ≥ 10% breaks charge posting.** The rule's rate (e.g. `12.0000`) is copied into `charges.tax_rate numeric(5,4)`, whose max is 9.9999. That includes Barcelona's seeded 10% IVA if it were applied to a charge type that gets posted. Fixed later, see §10 |
| S7b | Same through POS, room 210 (Hans Mueller) | Attempt 1: `HTTP 500`, row stays `pending` (retryable) | POS behaves correctly; the cause is HAIP's |
| S7c | Rule changed to 9% while POS was backing off | Attempt 2 (~15 s later) → `posted`. HAIP has the parent `food_beverage` 20.00 plus a child `tax` row of **1.80**, `tax_rate 9.0000`, "Live-run F&B tax", same folio | ✅ Tax rows work below 10% and are added by HAIP on top of the pre-tax amount POS sends. POS stores only the parent `haipChargeId` and never learns the tax amount |
| S7d | Cleanup | Both `LIVE_FB` rules deleted (0 remaining) | — |

### What this changes in sections 1–8

- **Task 1 (§4):** POS → HAIP posting is now **verified against real HAIP** for the in-house case (S1, S7c). It's still Partial because of S5/S6.
- **Task 5 / §5.1:** idempotency holds in practice: 6 replays of the same key (1 direct + 5 POS retries), still 1 charge. The duplicate→500 bug is confirmed (S2a/S2b).
- **Task 6 / §5.2:** the tax overflow at ≥10% has moved from *inferred* to **confirmed** (S7a). HAIP later fixed it in migration 0030, and 12% was verified live (§10).
- **§5.1 risk 2 (wrong guest)** has moved from *inferred* to **confirmed** (S6c). It raises the priority of TODO A1–A3. **Follow-up (committed in `e6ef9ef`; unit tested, but the 409 hasn't been seen against live HAIP):** POS now refuses to re-send any row HAIP rejected with "is vacant or has no in-house reservation".
  - `POST /outbox/:id/retry` → 409. The sweeper skips these rows, and the processor won't send one even if it is set back to `pending` by hand.
  - Staff must post the charge to the right folio in HAIP, then use `resolve` (`apps/api/src/haip/no-in-house-guard.ts`).
  - The match is on HAIP's error text, so it fails open if HAIP changes that wording. A dedicated `parked_reason` column (needs a migration) would be sturdier.
  - It doesn't cover a late first post, `failed` rows or automatic retries, so the wrong-guest risk stays open until POS posts by stay.
- **§5.3 checkout:** HAIP allows checkout while POS still holds an unposted charge for that room (S6a). That confirms §8 Q8 matters.

### State left behind (as of the 2026-10-25 run)

- **HAIP demo DB (persisted in the `haip_postgres-data` volume):**
  - Charges posted: 20.00 on res `…0007`, 20.00 + 1.80 tax on `…000b`, and the wrong-guest 20.00 on `…0011`.
  - Res `…0007` moved to room 205.
  - Res `…0010` checked out.
  - Res `…0011` assigned and checked in to room 110.
  - Two revoked Connect credentials.
  - To reset: `docker compose down -v` in `haip`. Note that a fresh HAIP DB then lacks `connect_credentials` (§6 last row).
- **POS:** scratch DB `stayx_pos_live` holds the test orders and outbox rows. Drop it with `docker compose exec postgres psql -U stayx -d postgres -c "drop database stayx_pos_live"`. The demo DB `stayx_pos` is unchanged.
- **Containers:** all HAIP and POS containers were stopped after the run, and the extra `haip-api-auth` container was removed.

---

## 10. HAIP update (cb8d140 → def7c03)

Reviewed on 2026-10-26 by reading `git log` and `git diff cb8d140..def7c03` in `haip` (54 commits, 234 files). Nothing was run. The §9 results are still from `cb8d140`.

Most of the update is payments (Worldline and hosted Connect checkout), phone-based online check-in, dashboard fixes and a repo-control tool. **Unchanged since `cb8d140`:**
- `modules/folio-inbound/`, `modules/pos/`, `modules/tax/`, `modules/reservation/`, `modules/webhook/` and `folio/folio.service.ts`;
- `keycloak/`, `push-schema.ts`, `migration-runner.ts` and `seed.ts`.

### Fixed

| Finding | Change | Notes |
|---|---|---|
| **Tax rates ≥ 10% fail with `numeric field overflow`** (§5.2, §9 S7a, §8 Q6) | `02a45f8` + `a89f413`: migration `0030_charges_tax_rate_widen.sql` changes `charges.tax_rate` to `numeric(8,4)`, matching `tax_rules.rate`; `schema/folio.ts:102-103` updated | **Only after the migration runs.** On a fresh DB, `push-schema.ts:346` still creates `numeric(5,4)`, then the runner applies 0030 (it runs every `NNNN_*.sql` ≥ 22), so it ends up correct. An existing DB needs `db:migrate`, or `docker compose up --build` so the `init` service runs it. **Verified live, see "Re-test" below** |

### Still open (no change in HAIP)

| §8 | Question | Evidence it's unchanged |
|---|---|---|
| Q1 | Stay lookup by room with the POS key | No new folio-inbound or connect read endpoint. The new connect routes are only booking payment ones (`connect.controller.ts`: `payment-status`, `confirm-payment`, `mock-pay`, `payment-return`) |
| Q2 | Post to a specific stay/folio, idempotently | `folio-inbound` and `pos` modules unchanged. Charges still go by room number at post time, so the wrong-guest risk (§9 S6c) remains. POS's guard (§9 follow-up) is still needed |
| Q3 | Duplicate `vendorTxnId` → 500 | `folio-inbound.service.ts` unchanged |
| Q4 | Reversal with the POS key | `folio.controller.ts` reverse route unchanged (JWT + `folios.manage`) |
| Q5 | `folio.charge_posted` for folio-inbound / charge lookup by `vendorTxnId` | `folio.service.ts` unchanged (still skips the webhook when given a transaction) |
| Q6 (rest) | Which tax rule applies to F&B; which of the two active profiles is meant | `seed.ts` and `tax.service.ts` unchanged: still no `food_beverage` rule, and `getActiveTaxProfile` still takes whichever active profile comes first |
| Q7 | Currency check on posting | `postCharge` unchanged |
| Q8 | Checkout with unposted POS charges | `reservation.service.ts` unchanged |
| Q9 | Keycloak POS/kitchen roles, audience, `property_ids` | `keycloak/` unchanged |
| Q10 | `connect_credentials` on a fresh DB | `push-schema.ts` unchanged and no new migration creates it. Migrations 0027–0030 don't touch it. A fresh HAIP DB still can't create API keys |

### §6 integration contract

- **No change** to `POST /folio-inbound/charges` (DTO, auth, responses), `POST /pos/charges`, `GET /connect/properties/:id` (`connect-content.service.ts` unchanged), or `/admin/connect/credentials`.
- **New, not relevant to POS:** Connect booking payment routes (above), `connect_payment_sessions` table (0029), `/webhooks/worldline`, and the online check-in module (`modules/guest-check-in/`).

### Does anything break the POS bridge?

**No code-level break:** our request, auth header and response handling all match the unchanged folio-inbound contract. Operational points:

1. **Run HAIP's migrations after updating.** Migration 0028 adds `rooms.external_lock_id` and `reservations.online_check_in_completed_at`, and the Drizzle schema now selects them. Folio-inbound only selects named columns from `rooms`/`reservations`, so posting should keep working on an unmigrated DB, but tax rates of 10% or more would still fail. Front-desk endpoints that select whole rows (e.g. `reservation.service.ts:1488` `findByIdRaw`, used by check-in, check-out and move-room) would fail with "column does not exist". Our `scripts/live-run*.mjs` use those endpoints. (Inferred from code, not run.)
2. **Rebuild the local `haip-api` image.** The one from the §9 run is built from `cb8d140`: `docker compose up -d --build` in `haip`, which also runs the migrations through `init`.
3. **Online check-in makes the wrong-guest case more likely, not less.** Guests can now check themselves in by phone (`guest-check-in.service.ts`), so a room can be re-let without the front desk. HAIP still picks the folio by room number at post time.

### Re-test on the rebuilt HAIP (2026-10-26)

**Local DB check (read-only).** No changes were needed.
- `schema_migrations` has 0027–0030, all applied 2026-10-25 14:33 UTC by `haip-init`, which exited 0 with "No pending SQL migrations" on the next start.
- `information_schema` shows:
  - `charges.tax_rate` is `numeric(8,4)`;
  - `rooms.external_lock_id` (`varchar(100)`) and `reservations.online_check_in_completed_at` (`timestamptz`) exist;
  - `connect_payment_sessions` exists.
- The `haip-api` image was built 2026-10-25 14:32 UTC, after `def7c03`.

**12% tax scenario (§9 S7, rate kept at 12%).**
- **Setup:** same as §9:
  - auth-on HAIP container from the rebuilt image on `:3001`;
  - POS API built from the current tree (includes the no-in-house guard), on scratch DB `stayx_pos_live`;
  - temporary key, revoked afterwards (a post with it then returned 401; the key is not in the POS log);
  - `LIVE_FB` 12% `food_beverage` rule on both active TGH profiles, deleted afterwards.
- **Script:** `scripts/live-run-tax12.mjs`, the S7 steps only from `scripts/live-run.mjs`.

| Step | Result |
|---|---|
| Direct post to `folio-inbound`, room 210, 20.00 USD | **201.** Parent `food_beverage` 20.00 plus child `tax` row **2.40, `tax_rate 12.0000`**, "Live-run F&B tax", on Hans Mueller's folio `f2000001-…000b` |
| POS order → delivered → outbox | **`posted` on attempt 1**, no error. Parent 20.00 + child tax **2.40 @ 12.0000** on the same folio. Folio balance 21.80 → 66.60 (two × 22.40) |
| HAIP log | No `numeric field overflow`, no unhandled exceptions |

**Result:** the §9 S7a failure is fixed at `def7c03` once migration 0030 is applied. POS still stores only the parent `haipChargeId` and never learns the tax amount (§9 S7c note stands).

### Questions still to send to the HAIP team

Q1, Q2, Q3, Q4, Q5, Q7, Q8, Q9 and Q10 as written in §8. Q6 is reduced to: "Which tax rule should apply to restaurant (`food_beverage`) charges, and which of the demo property's two active tax profiles is meant to be active? (The `tax_rate` width is fixed in 0030.)"

---

## 11. HAIP update (def7c03 → 928c2f6)

Reviewed on 2026-11-04 by reading `git log` and `git diff def7c03..928c2f6` in `haip` (14 commits), and by comparing migration 0029 with the local database. The §9 and §10 live runs weren't repeated on `928c2f6`.

**Nothing in this update affects POS.**
- **Unchanged since `def7c03`:** `modules/folio-inbound/`, `modules/pos/`, `modules/tax/`, `modules/folio/`, `modules/reservation/`, `modules/webhook/`, `modules/auth/`, `connect-content.service.ts`, `keycloak/`, `push-schema.ts`, `migration-runner.ts` and `seed.ts`.
- **What changed:** Connect branding clean-up (default booking channel `LIGARE` → `connect`, `clientPlatform` is now free text), guest check-in signatures, guest communications, and room status: `clean`, `inspected` and `guest_ready` rooms can now go back to `vacant_dirty`. POS uses none of these.
- **Open questions:** all items listed in §10 "Questions still to send" are unchanged.

### Migration note: 0029 edited after it was applied

- `0029_connect_payment_sessions.sql` was edited in `7310783` after it had been applied locally. It's the only migration changed, and there are no new ones.
- The edit only removes "(Ligare Hotels)" from a SQL comment, so the schema is the same. The local `connect_payment_sessions` table matches the file (21 columns, 5 foreign keys, 2 checks, primary key and 4 indexes) and has 0 rows. No database change is needed.
- POS has no references to this table or the Connect booking payment routes.
- **Process risk for the HAIP team:** `migration-runner.ts` tracks version, filename and applied time, with no checksum. An edit to an applied migration is neither re-run nor detected, so `haip-init` would still report "No pending SQL migrations" if a real schema change were made that way. Schema changes should always go in a new migration.

---

## 12. UI restyle

POS and KMS now match HAIP's staff dashboard through a shared package, `packages/ui` (merged in `9c6e07b`).

- **What's in it:** HAIP's colours and class names as Tailwind 4 tokens, self-hosted Montserrat, lucide icons and shared components. Parts are adapted from HAIP under Apache-2.0; see `packages/ui/NOTICE.md`.
- **POS (port 5180):** HAIP's sidebar and top bar, with order entry, cart, recent orders and menu admin restyled. Outbox/Errors is a greyed-out nav item until that screen exists.
- **KMS (port 5181):** light kitchen board with a top bar only, large touch targets and navy text on teal, orange and yellow for contrast.
- **Ports:** moved from 5174 (POS) and 5173 (KMS), because 5173 clashed with HAIP's dashboard.
- **Behaviour:** API calls and order, cart and board logic are unchanged. KMS Cancel now uses a styled confirm modal, with the same confirm step.
- **Checked on 2026-11-05:** both apps loaded on the new ports against the real POS API with the HAIP bridge off, and got 200s with the right CORS origin plus a live socket. The demo property had no active orders, so tickets were only seen with mock data.
- **Not yet tested:** a real kitchen tablet (§7 items 21 and 22) and React component tests (§7 item 20).

---

## 13. HAIP update (928c2f6 → 83f88e5)

Reviewed on 2026-11-12 as part of the integration design; see `INTEGRATION_DESIGN.md`.
- **What changed:** generic OIDC login, service-principal docs, a guest stays endpoint and migrations 0031–0032.
- **Effect on POS:** none on the bridge. The integration modules were unchanged.

---

## 14. HAIP update (83f88e5 → 439956d)

Reviewed on 2026-11-22 by reading `git log` and `git diff 83f88e5..439956d` in `haip` (8 commits), plus read-only checks of the containers and database. Nothing was changed or started.

**Rebuild and migration**
- `haip-init` exited 0 at 2026-11-22 08:08 UTC and applied `0033_rooms_status_changed_at.sql`. `schema_migrations` shows 0031–0033, with 0033 applied at 08:08:01 UTC.
- The init log has a harmless notice: "column status_changed_at already exists, skipping". `push-schema.ts` creates the column first, then the migration's `ADD COLUMN IF NOT EXISTS` skips it.
- The `haip-api` image was built 2026-11-22 08:07 UTC.

**Unchanged since `83f88e5`:** `modules/folio-inbound/`, `pos/`, `reservation/`, `connect/`, `webhook/`, `guest-check-in/`, `guest/`, `auth/`, `keycloak/`, `migration-runner.ts` and `integration-principal.ts`.
- **POS bridge:** no change.
- **Retry guard:** still valid. HAIP's "is vacant or has no in-house reservation" text is unchanged (`folio-inbound.service.ts:69`).
- **Posting by folio:** still safe. Non-open folios are still refused (`folio.service.ts:728-729`).
- **`connect_credentials`:** still missing from `push-schema.ts` (Q10 open).

**New: property-wide charge ledger** `GET /api/v1/folios/charges` (`folio.controller.ts:58-71`, `dto/list-property-charges.dto.ts`, `folio.service.ts:1129-1228`)

| Question | Answer |
|---|---|
| Auth | Staff or service-principal JWT with `folios.read`. **Not** usable with the POS API key |
| Filters | `propertyId` (required), `type`, `from`/`to` (service date), `folioId`, `reversalsOnly`, `page`, `limit` (max 100) |
| Find a charge by `vendorTxnId`? | **No.** No `vendorTxnId` or text filter, and no join to `folio_inbound_posts`. POS can only match on the description client-side ("Room service RS-… (n item lines)") |
| Helps reconciliation? | **Partly.** A nightly job could pull the day's `food_beverage` charges, including reversals, and match them to `posted` outbox rows. That needs a service principal, and the `byCurrency` totals cover the returned page only, not the whole window |
| Q5 / R5 | Q5 partly helped. R5 (lookup by `vendorTxnId` with the API key) is still needed |

**Tax (Q6): not fixed.**
- **What changed:** profile and rule changes are now written to `audit_logs`, with the acting user (`tax.service.ts`, `writeAudit`).
- **Profile selection unchanged:** `getActiveTaxProfile` still takes the first active profile with no ordering or tie-break (`tax.service.ts:217-229`).
- **Local data:** the demo property still has two active profiles (Miami Beach and Barcelona) and no `food_beverage` rule. No `LIVE_FB` test rules remain from §9 or §10.

**Room status:** records `status_changed_at` (migration 0033) and an audit row for each change. A new `GET /rooms/status-history` needs `rooms.read`. Transition rules and room assignment are unchanged, so there's no effect on charge routing.

**Other changes, none affecting POS:** admin role de-duplication (seed and roles service), email template overrides, rate-plan and rate-override reports, property settings merge, and a night-audit `mode` field accepted from cron. The service doesn't branch on it (`night-audit/dto/run-audit.dto.ts`).

**`INTEGRATION_DESIGN.md`:** none of R1–R8 is delivered. The Q5 and Q6 statuses and the shifted `folio.service.ts` / `folio.controller.ts` line citations are updated there.
