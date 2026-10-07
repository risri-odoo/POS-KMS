# StayX Room Service (POS + Kitchen Display)

StayX is a room-service ordering system for hotels. Staff take orders on a **POS** screen, the kitchen sees them live on a **kitchen display**, and delivered orders can be charged to the guest's room in a hotel system (HAIP).
This repository is a working demo you can run on your own computer.

> **⚠ Local demo only. There is no login.** Anyone who can reach these ports can see and change orders and the menu. Do not expose it to the internet or a shared network.

## Requirements

- **Docker Desktop**, installed and **running** (it hosts the database).
- **Node.js 20 or newer** (`node --version`).
- **pnpm** via Corepack: run `corepack enable` once (on Windows, in a terminal opened as Administrator if it complains about permissions).

## Quick start

```bash
git clone <this-repo-url> stayx-pos
cd stayx-pos
pnpm run setup      # install, start the database, apply migrations (first time only)
pnpm dev:all        # start the API, kitchen display and POS. Leave this running.
```

Then, in a **second terminal** in the same folder, once you see `Nest application successfully started`:

```bash
pnpm seed:demo      # adds a demo menu (safe to run again)
```

> Use **`pnpm run setup`**, not `pnpm setup`. `pnpm setup` is a built-in pnpm command that does something else.

## Open it

| What | URL |
|---|---|
| POS (take orders, edit the menu) | http://localhost:5174 |
| Kitchen display | http://localhost:5173 |
| API docs (Swagger) | http://localhost:4000/docs |

Both screens open the demo hotel (`a0000001-0000-4000-a000-000000000001`) automatically. To use another property, add `?propertyId=<uuid>` to the URL.

## 2-minute tour

1. **Kitchen screen** (http://localhost:5173): click **Enable sound** in the top right. Browsers only allow sound after you click something.
2. **POS** (http://localhost:5174), **New order** tab: tap a few menu tiles, enter a room number (e.g. `1204`), optionally add a note, and press **Place order**. You'll see the order number.
3. Look at the kitchen screen: the order appears in **Placed** with a beep.
4. On the kitchen screen press **Accept → Start preparing → Mark ready → Mark delivered**. Watch **Recent orders** on the POS update live.
5. POS → **Menu** tab: press **Edit** on an item, change its price, **Save**. New orders use the new price; existing orders keep theirs.
6. Switch an item **Off**. It disappears from the New order tiles straight away.

## Stop and reset

- **Stop the apps:** press `Ctrl+C` in the terminal running `pnpm dev:all` (stops all three). On Windows you'll then see `Failed` for each app and `Terminate batch job (Y/N)?`. That's normal: the apps have already stopped; type `Y` and Enter.
- **Stop the database:** `pnpm docker:down` (your data is kept).
- **Wipe all data and start fresh:** `docker compose down -v`, then `pnpm run setup` again.

## Troubleshooting

- **"Docker is not running" / `pnpm run setup` fails at the start:** open Docker Desktop and wait until it says it's running, then try again.
- **"Port … is already in use" / `EADDRINUSE`:** this demo uses ports **4000** (API), **5173** (kitchen), **5174** (POS), **5433** (Postgres) and **6380** (Redis). Close whatever is using them, or stop an older copy of this demo (`pnpm docker:down` in that folder).
  - Windows: `netstat -ano | findstr :5174` shows the process id; end it in Task Manager.
  - macOS/Linux: `lsof -i :5174`.
- **Screens show "Disconnected" or "Cannot reach the POS server":** the API isn't running. Check the `pnpm dev:all` terminal for errors.
- **`pnpm seed:demo` says it can't reach the API:** start `pnpm dev:all` first and wait for `Nest application successfully started`.
- **API log says `HAIP bridge DISABLED`:** that's expected. Posting to the hotel system is off unless you configure it (see below).
- **Using a tablet on the same Wi-Fi:** the screens listen on your network address, but they call the API at `localhost`, which only works on the computer running it. Create `.env.local` files in `apps/pos` and `apps/kms` with `VITE_API_URL=http://<your-computer-ip>:4000/api/v1`, and set `CORS_ORIGINS` in a root `.env` (see `.env.example`) to include `http://<your-computer-ip>:5173` and `:5174`.

## How it's built

A **NestJS API** (`apps/api`, port 4000) stores the menu, orders and an outbox of hotel-system postings in **PostgreSQL** (via Drizzle ORM). It prices every order on the server and pushes order changes to the screens over **Socket.IO**. Two **React + Vite** apps talk to it: the **POS** (`apps/pos`) for staff and the **kitchen display** (`apps/kms`). When an order is marked delivered, the API records a posting in the outbox in the same database transaction. If the HAIP bridge is configured, a **BullMQ** worker (backed by **Redis**) sends the charge to the guest's folio, exactly once, with retries. The database schema lives in `packages/database`.

## Not built yet

- **Login and permissions.** There are no user accounts; anyone with access can do everything.
- **Live hotel-system (HAIP) posting is OFF by default** and has only been tested against a simulated HAIP, never a real one. To try it, copy `.env.example` to `.env` and set `HAIP_API_KEY`, `HAIP_PROPERTY_ID` and `HAIP_API_URL`.
- **Room validation.** Any room number is accepted; the system doesn't check that a guest is staying in that room.
- **QR-code ordering for guests.** Only staff can place orders today.

## Useful commands

| Command | What it does |
|---|---|
| `pnpm run setup` | First-time setup (install, database, migrations) |
| `pnpm dev:all` | Run API + kitchen + POS together |
| `pnpm dev` / `pnpm dev:kms` / `pnpm dev:pos` | Run just one of them |
| `pnpm seed:demo` | Add the demo menu (idempotent) |
| `pnpm typecheck` / `pnpm test` | Type-check / run all tests |
| `pnpm docker:down` | Stop the database containers |
