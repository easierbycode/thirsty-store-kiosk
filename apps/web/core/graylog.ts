export type GraylogConfig = {
  url: string;
  token?: string;
  username?: string;
  password?: string;
  streamId?: string;
  rangeSeconds: number;
  defaultQuery: string;
};

export type ProductAnalysis = {
  productId: string;
  name: string;
  priceRange: string;
  min_sku_original_price: number;
  category: string;
  categoryRank: number | null;
  seller: string;
  creators: number;
  liveStreams: number;
  videos: number;
  gmv: number;
  customers: number;
  quantity: number;
  skuOrders: number;
  refunds: number;
  unitsRefunded: number;
  sampleCount: number;
  estimatedRetailValue: number;
  lastSeen: string | null;
  image?: string | null;
};

export type ComparisonRow = {
  productId: string;
  name: string;
  category: string;
  rank: number | null;
  creatorVideos: number;
  platformVideos: number;
  sales: number;
  min_sku_original_price: number;
  sampleValue: number;
  signal: string;
};

export type SampleValuation = {
  totalSamples: number;
  productsTracked: number;
  totalRetailValue: number;
  averageSampleValue: number;
  maintainableMonthlyValue: number;
  resale10Value: number;
  resale20Value: number;
  resale30Value: number;
  lastUpdated: string | null;
};

type GraylogTabularResponse = {
  schema?: Array<{ field?: string }>;
  datarows?: unknown[][];
};

let envFileCache: Record<string, string> | null = null;

const PRODUCT_ID_FIELDS = [
  "Product ID",
  "productId",
  "product_id",
  "tiktok_product_id",
  "tikTokProductId",
  "tt_product_id",
  "product.id",
  "productId.keyword",
];

const PRODUCT_NAME_FIELDS = [
  "Product",
  "Product Name",
  "name",
  "product_name",
  "productName",
  "title",
  "product_title",
  "productTitle",
  "product.name",
];

const MIN_PRICE_FIELDS = [
  "Min SKU Original Price",
  "Price",
  "min_sku_original_price",
  "minSkuOriginalPrice",
  "min_original_price",
  "minimum_original_price",
  "sku_original_price",
  "original_price",
  "retail_price",
  "msrp",
];

const SAMPLE_COUNT_FIELDS = [
  "Sample Count",
  "sample_count",
  "sampleCount",
  "samples",
  "quantity_available",
  "quantityAvailable",
  "available_samples",
];

const SEARCH_FIELDS = [
  "timestamp",
  "source",
  "message",
  "full_message",
  "core_data_json",
  "rows_json",
  "summary_json",
  "Product",
  "Product ID",
  "GMV",
  "Estimated commission",
  "Items sold",
  "productId",
  "product_id",
  "product_name",
  "min_sku_original_price",
  "category",
  "category_rank",
  "seller",
  "creator",
  "creators_count",
  "videos_count",
  "recent_livestreams_count",
  "gmv_direct",
  "gmv_affiliate",
  "items_sold",
  "scrapedAt",
];

export type GraylogGelfConfig = {
  url: string;
  key?: string;
};

// The GELF HTTP input is the system's write path: every scraper persists by
// posting GELF messages, and this app reads them back through the search API.
// GRAYLOG_GELF_URL overrides; otherwise the endpoint is derived from the API
// base, since the ngrok tunnels expose graylog-api and graylog-gelf side by
// side (see tok-scrape's ngrok.yml). The sidecar-minted GRAYLOG_TOKEN doubles
// as the `_graylog_key` the scrapers stamp on every message.
export function graylogGelfConfigFromEnv(): GraylogGelfConfig | null {
  const key = envValue("GRAYLOG_GELF_KEY") || envValue("GRAYLOG_TOKEN");
  const explicit = (envValue("GRAYLOG_GELF_URL") || "").replace(/\/+$/, "");
  if (explicit) {
    return {
      url: explicit.endsWith("/gelf") ? explicit : `${explicit}/gelf`,
      key,
    };
  }

  try {
    const url = new URL(
      envValue("GRAYLOG_API_URL") || envValue("GRAYLOG_URL") || "",
    );
    if (url.hostname.includes("-api.")) {
      url.hostname = url.hostname.replace("-api.", "-gelf.");
      url.pathname = "/gelf";
      url.search = "";
      return { url: url.href, key };
    }
  } catch {
    // No usable Graylog base URL — GELF writes are simply unavailable.
  }

  return null;
}

export async function sendGelfMessage(
  shortMessage: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const config = graylogGelfConfigFromEnv();
  if (!config) return false;

  const payload: Record<string, unknown> = {
    version: "1.1",
    host: "thirsty-store-kiosk",
    short_message: shortMessage,
    ...(config.key ? { _graylog_key: config.key } : {}),
  };
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    payload[`_${name}`] = value;
  }

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Price edits are written back to Graylog as `sample_edit_json` fields so they
// survive redeploys (the deployed filesystem is ephemeral). Returns the parsed
// edit records, newest first; errors degrade to "no recovered edits" so reads
// still work from the local store alone.
export async function fetchSampleEditRecords(
  limit = 500,
): Promise<Record<string, unknown>[]> {
  const config = graylogConfigFromEnv();
  if (!config) return [];

  try {
    const messages = await searchGraylog(config, "sample_edit_json:*", limit, [
      "timestamp",
      "sample_edit_json",
    ]);
    return messages
      .map((message) => parseJsonValue(message.sample_edit_json))
      .filter(isRecord);
  } catch {
    return [];
  }
}

export function graylogConfigFromEnv(): GraylogConfig | null {
  const url = normalizeGraylogUrl(
    envValue("GRAYLOG_API_URL") || envValue("GRAYLOG_URL"),
  );
  if (!url) return null;

  return {
    url,
    token: envValue("GRAYLOG_TOKEN"),
    username: envValue("GRAYLOG_USERNAME"),
    password: envValue("GRAYLOG_PASSWORD"),
    streamId: envValue("GRAYLOG_STREAM_ID"),
    rangeSeconds: numberFrom(
      envValue("GRAYLOG_RANGE_SECONDS"),
      60 * 60 * 24 * 30,
    ),
    defaultQuery: envValue("GRAYLOG_PRODUCT_QUERY") ||
      "rows_json:* OR core_data_json:*",
  };
}

function normalizeGraylogUrl(value: string | undefined): string {
  const normalized = (value || "").replace(/\/+$/, "").replace(/\/api$/, "");
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    if (url.pathname === "/gelf") {
      url.pathname = "";
      url.hostname = url.hostname.replace("-gelf.", "-api.");
      return url.href.replace(/\/+$/, "");
    }
  } catch {
    // Keep the raw normalized value for local or non-URL Graylog bases.
  }

  return normalized;
}

export function envValue(name: string): string | undefined {
  const fileValue = dotEnv()[name];
  if (fileValue !== undefined && fileValue !== "") return fileValue;
  return Deno.env.get(name) || undefined;
}

function dotEnv(): Record<string, string> {
  if (envFileCache) return envFileCache;

  envFileCache = {};

  try {
    const text = Deno.readTextFileSync(".env");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;

      envFileCache[match[1]] = unquoteEnvValue(match[2]);
    }
  } catch {
    // The deployed app can still use real environment variables.
  }

  return envFileCache;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export async function fetchProductAnalysis(
  productId: string,
): Promise<ProductAnalysis | null> {
  const config = graylogConfigFromEnv();
  if (!config) return null;

  const products = await fetchRecentProducts(1000);
  const exact = products.find((product) => product.productId === productId);

  return exact || null;
}

export async function fetchRecentProducts(
  limit = 100,
): Promise<ProductAnalysis[]> {
  const config = graylogConfigFromEnv();
  if (!config) return [];

  const messageLimit = Math.max(25, Math.min(limit, 500));
  const messages = await searchGraylog(
    config,
    config.defaultQuery,
    messageLimit,
  );
  const products = new Map<string, ProductAnalysis>();

  for (const record of productRecordsFromMessages(messages)) {
    const product = normalizeProduct(record);
    if (!product) continue;

    const existing = products.get(product.productId);
    products.set(
      product.productId,
      existing ? mergeProduct(existing, product) : product,
    );
  }

  return [...products.values()]
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, limit);
}

export async function fetchComparison(): Promise<ComparisonRow[]> {
  const products = await fetchRecentProducts(200);

  return products
    .map((product) => {
      const creatorVideos = product.creators || product.videos || 0;
      const platformVideos = product.videos || 0;
      const rank = product.categoryRank;
      const sampleValue = product.sampleCount * product.min_sku_original_price;

      return {
        productId: product.productId,
        name: product.name,
        category: product.category,
        rank,
        creatorVideos,
        platformVideos,
        sales: product.gmv,
        min_sku_original_price: product.min_sku_original_price,
        sampleValue,
        signal: comparisonSignal(
          rank,
          creatorVideos,
          platformVideos,
          product.gmv,
        ),
      };
    })
    .sort((a, b) => {
      const aRank = a.rank ?? 999999;
      const bRank = b.rank ?? 999999;
      return aRank - bRank || b.sampleValue - a.sampleValue;
    });
}

export async function fetchSampleValuation(): Promise<SampleValuation> {
  const products = await fetchRecentProducts(500);
  const totalSamples = products.reduce(
    (sum, product) => sum + product.sampleCount,
    0,
  );
  const totalRetailValue = products.reduce((sum, product) => {
    const itemValue = product.estimatedRetailValue ||
      product.sampleCount * product.min_sku_original_price;
    return sum + itemValue;
  }, 0);
  const lastUpdated =
    products.map((product) => product.lastSeen).filter(Boolean).sort().at(-1) ||
    null;

  return {
    totalSamples,
    productsTracked: products.length,
    totalRetailValue,
    averageSampleValue: totalSamples ? totalRetailValue / totalSamples : 0,
    maintainableMonthlyValue: Math.min(totalRetailValue, 5000),
    resale10Value: totalRetailValue * 0.1,
    resale20Value: totalRetailValue * 0.2,
    resale30Value: totalRetailValue * 0.3,
    lastUpdated,
  };
}

async function searchGraylog(
  config: GraylogConfig,
  query: string,
  limit: number,
  fields: string[] = SEARCH_FIELDS,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${config.url}/api/search/messages`);
  const body = {
    query: query || "*",
    timerange: { type: "relative", range: config.rangeSeconds },
    size: limit,
    sort: "timestamp",
    sort_order: "Descending",
    fields,
    ...(config.streamId ? { streams: [config.streamId] } : {}),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: graylogHeaders(config),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Graylog search failed: ${response.status} ${await response.text()}`,
    );
  }

  return recordsFromTabularResponse(await response.json());
}

function graylogHeaders(config: GraylogConfig): HeadersInit {
  const headers: Record<string, string> = {
    "accept": "application/json",
    "content-type": "application/json",
    "x-requested-by": "thirsty-store-kiosk",
  };

  if (config.token) {
    headers.authorization = `Basic ${btoa(`${config.token}:token`)}`;
  } else if (config.username && config.password) {
    headers.authorization = `Basic ${
      btoa(`${config.username}:${config.password}`)
    }`;
  }

  return headers;
}

function recordsFromTabularResponse(
  body: GraylogTabularResponse,
): Record<string, unknown>[] {
  const fields = Array.isArray(body.schema)
    ? body.schema.map((entry) => entry.field || "").filter(Boolean)
    : [];
  const rows = Array.isArray(body.datarows) ? body.datarows : [];

  return rows.map((row) => {
    const record: Record<string, unknown> = {};

    fields.forEach((field, index) => {
      const value = normalizeGraylogCell(row[index]);
      if (value !== undefined) record[field] = value;
    });

    return record;
  });
}

function productRecordsFromMessages(
  messages: Record<string, unknown>[],
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];

  for (const message of messages) {
    records.push(...productRecordsFromMessage(message));
  }

  return records;
}

function productRecordsFromMessage(
  message: Record<string, unknown>,
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];

  for (const field of ["rows_json", "core_data_json", "summary_json"]) {
    const parsed = parseJsonValue(message[field]);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isRecord(item)) records.push(withMessageContext(message, item));
      }
    } else if (isRecord(parsed)) {
      records.push(...productRecordsFromParsedObject(message, parsed));
    }
  }

  return records.length ? records : [message];
}

function productRecordsFromParsedObject(
  message: Record<string, unknown>,
  parsed: Record<string, unknown>,
): Record<string, unknown>[] {
  const rows = first(parsed, ["rows", "products", "data", "items"]);

  if (Array.isArray(rows)) {
    return rows
      .filter(isRecord)
      .map((row) => withMessageContext(message, row));
  }

  return [withMessageContext(message, parsed)];
}

function withMessageContext(
  message: Record<string, unknown>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    timestamp: message.timestamp,
    source: message.source,
    creator: message.creator,
    scrapedAt: message.scrapedAt,
    ...row,
  };
}

function normalizeProduct(
  source: Record<string, unknown>,
): ProductAnalysis | null {
  const productId = stringFrom(first(source, PRODUCT_ID_FIELDS));
  if (!productId) return null;

  const minSkuOriginalPrice = numberFrom(first(source, MIN_PRICE_FIELDS), 0);
  const sampleCount = numberFrom(first(source, SAMPLE_COUNT_FIELDS), 1);
  const estimatedRetailValue = numberFrom(
    first(source, [
      "estimated_retail_value",
      "estimatedRetailValue",
      "sample_value",
      "sampleValue",
    ]),
    sampleCount * minSkuOriginalPrice,
  );

  return {
    productId,
    name: stringFrom(first(source, PRODUCT_NAME_FIELDS)) ||
      `Product ${productId}`,
    priceRange: stringFrom(
      first(source, ["priceRange", "price_range", "sku_price_range"]),
    ) ||
      formatPriceRange(source),
    min_sku_original_price: minSkuOriginalPrice,
    category: stringFrom(
      first(source, ["category", "product_category", "category_name"]),
    ) || "Uncategorized",
    categoryRank: numberOrNull(
      first(source, ["category_rank", "categoryRank", "rank", "Rank"]),
    ),
    seller: stringFrom(
      first(source, ["seller", "seller_name", "shop_name", "shopName"]),
    ) || "Unknown seller",
    creators: numberFrom(
      first(source, [
        "creators",
        "creator_count",
        "creatorCount",
        "creators_count",
      ]),
      0,
    ),
    liveStreams: numberFrom(
      first(source, [
        "liveStreams",
        "live_streams",
        "live_count",
        "liveCount",
        "recent_livestreams_count",
      ]),
      0,
    ),
    videos: numberFrom(
      first(source, [
        "videos",
        "video_count",
        "videoCount",
        "platform_videos",
        "videos_count",
      ]),
      0,
    ),
    gmv: numberFrom(
      first(source, [
        "GMV",
        "gmv",
        "sales",
        "revenue",
        "gmv_direct",
        "gmv_affiliate",
      ]),
      0,
    ),
    customers: numberFrom(
      first(source, ["customers", "customer_count", "customerCount"]),
      0,
    ),
    quantity: numberFrom(
      first(source, [
        "Items sold",
        "quantity",
        "quantity_sold",
        "items_sold",
        "units_sold",
      ]),
      0,
    ),
    skuOrders: numberFrom(
      first(source, [
        "Items sold",
        "skuOrders",
        "sku_orders",
        "orders",
        "order_count",
      ]),
      0,
    ),
    refunds: numberFrom(
      first(source, ["refunds", "refund_amount", "refundAmount"]),
      0,
    ),
    unitsRefunded: numberFrom(
      first(source, ["unitsRefunded", "units_refunded", "refund_units"]),
      0,
    ),
    sampleCount,
    estimatedRetailValue,
    lastSeen: stringFrom(
      first(source, [
        "scrapedAt",
        "timestamp",
        "event_time",
        "created_at",
        "updated_at",
      ]),
    ) || null,
    image: stringFrom(
      first(source, [
        "image",
        "image_url",
        "imageUrl",
        "picture_url",
        "pictureUrl",
        "cover",
        "thumbnail",
        "img",
      ]),
    ) || null,
  };
}

function mergeProduct(
  current: ProductAnalysis,
  incoming: ProductAnalysis,
): ProductAnalysis {
  const fallbackName = `Product ${incoming.productId}`;

  return {
    ...current,
    ...incoming,
    name: incoming.name === fallbackName && current.name !== fallbackName
      ? current.name
      : incoming.name,
    priceRange:
      incoming.priceRange === "Unknown" && current.priceRange !== "Unknown"
        ? current.priceRange
        : incoming.priceRange,
    category: incoming.category === "Uncategorized" &&
        current.category !== "Uncategorized"
      ? current.category
      : incoming.category,
    seller: incoming.seller === "Unknown seller" &&
        current.seller !== "Unknown seller"
      ? current.seller
      : incoming.seller,
    creators: Math.max(current.creators, incoming.creators),
    liveStreams: Math.max(current.liveStreams, incoming.liveStreams),
    videos: Math.max(current.videos, incoming.videos),
    gmv: Math.max(current.gmv, incoming.gmv),
    customers: Math.max(current.customers, incoming.customers),
    quantity: Math.max(current.quantity, incoming.quantity),
    skuOrders: Math.max(current.skuOrders, incoming.skuOrders),
    refunds: Math.max(current.refunds, incoming.refunds),
    unitsRefunded: Math.max(current.unitsRefunded, incoming.unitsRefunded),
    sampleCount: Math.max(current.sampleCount, incoming.sampleCount),
    estimatedRetailValue: Math.max(
      current.estimatedRetailValue,
      incoming.estimatedRetailValue,
    ),
    min_sku_original_price: incoming.min_sku_original_price ||
      current.min_sku_original_price,
    lastSeen:
      [current.lastSeen, incoming.lastSeen].filter(Boolean).sort().at(-1) ||
      null,
    image: incoming.image || current.image || null,
  };
}

function first(source: Record<string, unknown>, fields: string[]): unknown {
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function numberFrom(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function numberOrNull(value: unknown): number | null {
  const parsed = numberFrom(value, NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringFrom(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function normalizeGraylogCell(value: unknown): unknown {
  if (value === undefined || value === null || value === "-") return undefined;
  return value;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim() || value === "-") {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatPriceRange(source: Record<string, unknown>): string {
  const min = numberFrom(first(source, MIN_PRICE_FIELDS), 0);
  const max = numberFrom(
    first(source, [
      "max_sku_original_price",
      "maxSkuOriginalPrice",
      "max_original_price",
    ]),
    min,
  );
  if (!min && !max) return "Unknown";
  if (min === max) return currency(min);
  return `${currency(min)}-${currency(max)}`;
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
    .format(value);
}

function comparisonSignal(
  rank: number | null,
  creatorVideos: number,
  platformVideos: number,
  gmv: number,
): string {
  if (
    (rank !== null && rank <= 10 || gmv >= 1000) && creatorVideos <= 2 &&
    platformVideos >= 50
  ) {
    return "Under-posted";
  }
  if (creatorVideos >= 8 && gmv < 1000) return "Over-posted";
  if (rank !== null && rank <= 25) return "Priority";
  return "Watch";
}
