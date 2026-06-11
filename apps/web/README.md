# Thirsty Deno Deploy Web App

Deploy from `apps/web`.

## Graylog environment

Set these in Deno Deploy:

- `GRAYLOG_URL`: Base Graylog URL, for example `https://graylog.example.com`. A trailing `/api` is also accepted.
- `GRAYLOG_TOKEN`: Graylog access token. The app sends it as Basic auth with password `token`.
- `GRAYLOG_USERNAME` and `GRAYLOG_PASSWORD`: Optional fallback when a token is not used.
- `GRAYLOG_STREAM_ID`: Optional stream filter.
- `GRAYLOG_RANGE_SECONDS`: Optional search window. Defaults to 7 days.
- `GRAYLOG_PRODUCT_QUERY`: Optional default query for the dashboard product lists. Defaults to `*`.

## Durable sample persistence (GELF write-back)

The deployed filesystem is ephemeral, so sample products and price edits are
also written back to Graylog as GELF messages (`core_data_json` +
`sample_edit_json` fields) and recovered on read. This works out of the box
when `GRAYLOG_URL` points at a `…-api.…` ngrok tunnel with a matching
`…-gelf.…` tunnel (see tok-scrape `ngrok.yml`); override with:

- `GRAYLOG_GELF_URL`: Full GELF HTTP input URL, for example `https://tok-graylog-gelf.ngrok-free.dev/gelf`.
- `GRAYLOG_GELF_KEY`: Value stamped as `_graylog_key` on each message. Defaults to `GRAYLOG_TOKEN`.

## Existing Graylog fields

The mapper accepts common field variants so existing data does not need to be renamed.

Product IDs:

- `productId`
- `product_id`
- `tiktok_product_id`
- `tikTokProductId`
- `tt_product_id`

Product names:

- `name`
- `product_name`
- `productName`
- `title`
- `product_title`

Sample valuation:

- `min_sku_original_price`
- `minSkuOriginalPrice`
- `min_original_price`
- `sku_original_price`
- `original_price`
- `retail_price`
- `msrp`

Sample counts:

- `sample_count`
- `sampleCount`
- `samples`
- `quantity_available`
- `available_samples`
