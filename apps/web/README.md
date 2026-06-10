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
