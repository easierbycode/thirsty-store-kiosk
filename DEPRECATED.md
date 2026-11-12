# ⚠️ Deprecated — superseded by thirsty.store

As of **2026-06-13**, this app (`thirsty-store-kiosk`, deployed at
`thirsty-store-kiosk.easierbycode.deno.net`) is **deprecated**. Everything it
served has moved into **data-pimp → https://thirsty.store**, which is now the
single home of **Thirsty OS** and the **Product Analysis** dashboard.

## What moved

| Was here (kiosk) | Now (thirsty.store / data-pimp) |
| --- | --- |
| Thirsty OS desktop (`/`) | `https://thirsty.store/` |
| Product Analysis dashboard (`/inventory`) | `https://thirsty.store/inventory` |
| Product catalog (`/api/products`) | `https://thirsty.store/api/products` (Postgres-backed, CORS) |
| Dashboard backend (`core/graylog.ts`, `core/samples.ts`) | `data-pimp/core/*` |

## Consumers already repointed

- **tiktok-sample-tracker** (`admin.thirsty.store`) — `src/lib/kiosk.ts`
  `KIOSK_API_URL` default → `https://thirsty.store`.
- **data-pimp Thirsty OS** — the "Product Analysis" app now loads the
  same-origin `/inventory`.

## Before fully shutting down the Deno Deploy deployment

1. **Set the dashboard secrets in data-pimp's Deploy env** (they currently
   live only in *this* project's Deploy settings), or the Product Analysis
   analytics stay empty: `GRAYLOG_API_URL` (or `GRAYLOG_URL`) + `GRAYLOG_TOKEN`
   (or `GRAYLOG_USERNAME`/`GRAYLOG_PASSWORD`), optional `GRAYLOG_STREAM_ID`,
   `GRAYLOG_RANGE_SECONDS`, `GRAYLOG_PRODUCT_QUERY`, `GRAYLOG_GELF_URL`,
   `GRAYLOG_GELF_KEY`; and `SCRAPECREATORS_API_KEY` for "Look Up Price".
2. **Confirm no compiled desktop/kiosk binary is still in the field.** The
   `apps/admin` build heartbeats `/api/heartbeat` here every 5s; that endpoint
   is *not* re-homed. If a field device still runs it, either keep this
   deployment alive for the fleet endpoints or rebuild the binary against
   thirsty.store first.

Only after both are satisfied is it safe to delete the deployment. The repo is
kept for history; nothing new should be built on it.
