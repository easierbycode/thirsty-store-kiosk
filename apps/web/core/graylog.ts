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

type GraylogMessageEnvelope = {
  message?: Record<string, unknown>;
};

const PRODUCT_ID_FIELDS = [
  "productId",
  "product_id",
  "tiktok_product_id",
  "tikTokProductId",
  "tt_product_id",
  "product.id",
  "productId.keyword",
];

const PRODUCT_NAME_FIELDS = [
  "name",
  "product_name",
  "productName",
  "title",
  "product_title",
  "productTitle",
  "product.name",
];

const MIN_PRICE_FIELDS = [
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
  "sample_count",
  "sampleCount",
  "samples",
  "quantity_available",
  "quantityAvailable",
  "available_samples",
];

export function graylogConfigFromEnv(): GraylogConfig | null {
  const url = normalizeGraylogUrl(Deno.env.get("GRAYLOG_URL"));
  if (!url) return null;

  return {
    url,
    token: Deno.env.get("GRAYLOG_TOKEN") || undefined,
    username: Deno.env.get("GRAYLOG_USERNAME") || undefined,
    password: Deno.env.get("GRAYLOG_PASSWORD") || undefined,
    streamId: Deno.env.get("GRAYLOG_STREAM_ID") || undefined,
    rangeSeconds: numberFrom(Deno.env.get("GRAYLOG_RANGE_SECONDS"), 60 * 60 * 24 * 7),
    defaultQuery: Deno.env.get("GRAYLOG_PRODUCT_QUERY") || "*",
  };
}

function normalizeGraylogUrl(value: string | undefined): string {
  return (value || "").replace(/\/+$/, "").replace(/\/api$/, "");
}

export async function fetchProductAnalysis(productId: string): Promise<ProductAnalysis | null> {
  const config = graylogConfigFromEnv();
  if (!config) return null;

  const escapedId = escapeGraylogValue(productId);
  const query = PRODUCT_ID_FIELDS.map((field) => `${field}:${escapedId}`).join(" OR ");
  const messages = await searchGraylog(config, query, 50);
  const products = messages.map(normalizeProduct).filter(Boolean) as ProductAnalysis[];
  const exact = products.find((product) => product.productId === productId);

  return exact || products[0] || null;
}

export async function fetchRecentProducts(limit = 100): Promise<ProductAnalysis[]> {
  const config = graylogConfigFromEnv();
  if (!config) return [];

  const messages = await searchGraylog(config, config.defaultQuery, limit);
  const products = new Map<string, ProductAnalysis>();

  for (const message of messages) {
    const product = normalizeProduct(message);
    if (!product) continue;

    const existing = products.get(product.productId);
    products.set(product.productId, existing ? mergeProduct(existing, product) : product);
  }

  return [...products.values()].sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
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
        signal: comparisonSignal(rank, creatorVideos, platformVideos, product.gmv),
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
  const totalSamples = products.reduce((sum, product) => sum + product.sampleCount, 0);
  const totalRetailValue = products.reduce((sum, product) => {
    const itemValue = product.estimatedRetailValue || product.sampleCount * product.min_sku_original_price;
    return sum + itemValue;
  }, 0);
  const lastUpdated = products.map((product) => product.lastSeen).filter(Boolean).sort().at(-1) || null;

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

async function searchGraylog(config: GraylogConfig, query: string, limit: number): Promise<Record<string, unknown>[]> {
  const url = new URL(`${config.url}/api/search/universal/relative`);
  url.searchParams.set("query", query || "*");
  url.searchParams.set("range", String(config.rangeSeconds));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "timestamp:desc");

  if (config.streamId) {
    url.searchParams.set("filter", `streams:${config.streamId}`);
  }

  const response = await fetch(url, {
    headers: graylogHeaders(config),
  });

  if (!response.ok) {
    throw new Error(`Graylog search failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  const envelopes = Array.isArray(body.messages) ? body.messages as GraylogMessageEnvelope[] : [];
  return envelopes.map((item) => item.message || {}).filter((item) => Object.keys(item).length > 0);
}

function graylogHeaders(config: GraylogConfig): HeadersInit {
  const headers: Record<string, string> = {
    "accept": "application/json",
    "x-requested-by": "thirsty-store-kiosk",
  };

  if (config.token) {
    headers.authorization = `Basic ${btoa(`${config.token}:token`)}`;
  } else if (config.username && config.password) {
    headers.authorization = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  }

  return headers;
}

function normalizeProduct(source: Record<string, unknown>): ProductAnalysis | null {
  const productId = stringFrom(first(source, PRODUCT_ID_FIELDS));
  if (!productId) return null;

  const minSkuOriginalPrice = numberFrom(first(source, MIN_PRICE_FIELDS), 0);
  const sampleCount = numberFrom(first(source, SAMPLE_COUNT_FIELDS), 1);
  const estimatedRetailValue = numberFrom(
    first(source, ["estimated_retail_value", "estimatedRetailValue", "sample_value", "sampleValue"]),
    sampleCount * minSkuOriginalPrice,
  );

  return {
    productId,
    name: stringFrom(first(source, PRODUCT_NAME_FIELDS)) || `Product ${productId}`,
    priceRange: stringFrom(first(source, ["priceRange", "price_range", "sku_price_range"])) ||
      formatPriceRange(source),
    min_sku_original_price: minSkuOriginalPrice,
    category: stringFrom(first(source, ["category", "product_category", "category_name"])) || "Uncategorized",
    categoryRank: numberOrNull(first(source, ["category_rank", "categoryRank", "rank"])),
    seller: stringFrom(first(source, ["seller", "seller_name", "shop_name", "shopName"])) || "Unknown seller",
    creators: numberFrom(first(source, ["creators", "creator_count", "creatorCount"]), 0),
    liveStreams: numberFrom(first(source, ["liveStreams", "live_streams", "live_count", "liveCount"]), 0),
    videos: numberFrom(first(source, ["videos", "video_count", "videoCount", "platform_videos"]), 0),
    gmv: numberFrom(first(source, ["gmv", "sales", "revenue"]), 0),
    customers: numberFrom(first(source, ["customers", "customer_count", "customerCount"]), 0),
    quantity: numberFrom(first(source, ["quantity", "quantity_sold", "items_sold", "units_sold"]), 0),
    skuOrders: numberFrom(first(source, ["skuOrders", "sku_orders", "orders", "order_count"]), 0),
    refunds: numberFrom(first(source, ["refunds", "refund_amount", "refundAmount"]), 0),
    unitsRefunded: numberFrom(first(source, ["unitsRefunded", "units_refunded", "refund_units"]), 0),
    sampleCount,
    estimatedRetailValue,
    lastSeen: stringFrom(first(source, ["timestamp", "event_time", "created_at", "updated_at"])) || null,
  };
}

function mergeProduct(current: ProductAnalysis, incoming: ProductAnalysis): ProductAnalysis {
  return {
    ...current,
    ...incoming,
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
    estimatedRetailValue: Math.max(current.estimatedRetailValue, incoming.estimatedRetailValue),
    min_sku_original_price: incoming.min_sku_original_price || current.min_sku_original_price,
    lastSeen: [current.lastSeen, incoming.lastSeen].filter(Boolean).sort().at(-1) || null,
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

function formatPriceRange(source: Record<string, unknown>): string {
  const min = numberFrom(first(source, MIN_PRICE_FIELDS), 0);
  const max = numberFrom(first(source, ["max_sku_original_price", "maxSkuOriginalPrice", "max_original_price"]), min);
  if (!min && !max) return "Unknown";
  if (min === max) return currency(min);
  return `${currency(min)}-${currency(max)}`;
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function comparisonSignal(
  rank: number | null,
  creatorVideos: number,
  platformVideos: number,
  gmv: number,
): string {
  if ((rank !== null && rank <= 10 || gmv >= 1000) && creatorVideos <= 2 && platformVideos >= 50) {
    return "Under-posted";
  }
  if (creatorVideos >= 8 && gmv < 1000) return "Over-posted";
  if (rank !== null && rank <= 25) return "Priority";
  return "Watch";
}

function escapeGraylogValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
