import { dirname } from "https://deno.land/std/path/mod.ts";
import {
  type ComparisonRow,
  envValue,
  fetchProductAnalysis,
  fetchRecentProducts,
  type ProductAnalysis,
  type SampleValuation,
} from "./graylog.ts";

export type SamplePriceEdit = {
  productId: string;
  price: number;
  sampleCount?: number;
  notes?: string;
  source: "manual" | "scrapecreators";
  sourceUrl?: string;
  apiTitle?: string;
  apiSeller?: string;
  fetchedAt?: string;
  updatedAt: string;
};

export type UnpricedSample = {
  productId: string;
  name: string;
  originalPrice: number;
  price: number;
  sampleCount: number;
  sampleValue: number;
  gmv: number;
  quantity: number;
  lastSeen: string | null;
  notes: string;
  source: string;
  sourceUrl: string | null;
  apiTitle: string | null;
  apiSeller: string | null;
  fetchedAt: string | null;
  updatedAt: string | null;
  priced: boolean;
};

export type UnpricedSampleList = {
  items: UnpricedSample[];
  total: number;
  unpricedCount: number;
  pricedCount: number;
};

type SampleStore = {
  version: 1;
  edits: Record<string, SamplePriceEdit>;
};

type SampleUpdateInput = {
  price?: unknown;
  sampleCount?: unknown;
  notes?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
  apiTitle?: unknown;
  apiSeller?: unknown;
  fetchedAt?: unknown;
};

type ScrapeCreatorsPrice = {
  price: number;
  sourceUrl: string;
  title?: string;
  seller?: string;
};

const DEFAULT_STORE_PATH = ".thirsty/sample-prices.json";
const DEFAULT_SCRAPECREATORS_BASE = "https://api.scrapecreators.com";
const DEFAULT_REGION = "US";

export async function listUnpricedSamples(
  query = "",
  limit = 100,
): Promise<UnpricedSampleList> {
  const products = await fetchRecentProducts(1000);
  const store = await readStore();
  const normalizedQuery = query.trim().toLowerCase();
  const items = products
    .filter((product) => product.sampleCount > 0)
    .filter((product) =>
      product.min_sku_original_price <= 0 || store.edits[product.productId]
    )
    .map((product) =>
      sampleFromProduct(product, store.edits[product.productId])
    )
    .filter((sample) => matchesQuery(sample, normalizedQuery))
    .sort((a, b) =>
      Number(a.priced) - Number(b.priced) || a.name.localeCompare(b.name)
    );

  const total = items.length;
  const unpricedCount = items.filter((item) => !item.priced).length;

  // Samples the user has already priced (via Save or Fetch API) sort below the
  // unpriced backlog, so a plain slice(0, limit) drops a freshly priced row off
  // the end whenever the backlog is larger than the limit -- making it look like
  // the price never updated. Always keep edited samples in the page; the limit
  // only bounds how much of the unpriced backlog we return.
  const edited = items.filter((item) => store.edits[item.productId]);
  const backlog = items.filter((item) => !store.edits[item.productId]);
  const visible = [
    ...edited,
    ...backlog.slice(0, Math.max(0, limit - edited.length)),
  ].sort((a, b) =>
    Number(a.priced) - Number(b.priced) || a.name.localeCompare(b.name)
  );

  return {
    items: visible,
    total,
    unpricedCount,
    pricedCount: total - unpricedCount,
  };
}

export async function updateSamplePrice(
  productId: string,
  input: SampleUpdateInput,
): Promise<UnpricedSample> {
  const products = await fetchRecentProducts(1000);
  const product = products.find((item) => item.productId === productId);
  if (!product) {
    throw new Error(`Product ${productId} was not found in Graylog`);
  }

  const store = await readStore();
  const existing = store.edits[productId];
  const now = new Date().toISOString();
  const price = input.price === undefined
    ? existing?.price ?? 0
    : numericInput(input.price, "price");
  const sampleCount = input.sampleCount === undefined
    ? existing?.sampleCount
    : numericInput(input.sampleCount, "sample count");
  const notes = input.notes === undefined
    ? existing?.notes
    : String(input.notes || "").trim();
  // A confirmed ScrapeCreators price saves through here too, carrying the
  // fetched provenance so the row keeps its "API" source tag after saving.
  const fromApi = input.source === "scrapecreators";

  store.edits[productId] = {
    productId,
    price,
    sampleCount,
    notes,
    source: fromApi ? "scrapecreators" : "manual",
    sourceUrl: fromApi
      ? optionalString(input.sourceUrl) ?? existing?.sourceUrl
      : undefined,
    apiTitle: fromApi
      ? optionalString(input.apiTitle) ?? existing?.apiTitle
      : undefined,
    apiSeller: fromApi
      ? optionalString(input.apiSeller) ?? existing?.apiSeller
      : undefined,
    fetchedAt: fromApi
      ? optionalString(input.fetchedAt) ?? existing?.fetchedAt ?? now
      : undefined,
    updatedAt: now,
  };
  await writeStore(store);

  return sampleFromProduct(product, store.edits[productId]);
}

export async function fetchPriceForSample(
  productId: string,
): Promise<UnpricedSample> {
  const products = await fetchRecentProducts(1000);
  const product = products.find((item) => item.productId === productId);
  if (!product) {
    throw new Error(`Product ${productId} was not found in Graylog`);
  }

  const lookup = await fetchScrapeCreatorsPrice(product);
  if (lookup.price <= 0) {
    throw new Error("ScrapeCreators returned no usable price");
  }

  // Look up only -- do not persist. The client previews this proposed price
  // and must confirm before updateSamplePrice() commits it to the store.
  const existing = (await readStore()).edits[productId];
  const now = new Date().toISOString();
  const proposed: SamplePriceEdit = {
    productId,
    price: lookup.price,
    sampleCount: existing?.sampleCount,
    notes: existing?.notes,
    source: "scrapecreators",
    sourceUrl: lookup.sourceUrl,
    apiTitle: lookup.title,
    apiSeller: lookup.seller,
    fetchedAt: now,
    updatedAt: now,
  };

  return sampleFromProduct(product, proposed);
}

export async function fetchProductWithEdits(
  productId: string,
): Promise<ProductAnalysis | null> {
  const product = await fetchProductAnalysis(productId);
  if (!product) return null;

  // The product-detail view reads raw Graylog data, so a price recovered via
  // Save or Fetch API (stored as an edit) would otherwise never show here even
  // though the sample queue reflects it. Apply the edit so both views agree.
  const edit = (await readStore()).edits[productId];
  if (!edit) return product;

  const price = edit.price ?? product.min_sku_original_price;
  return {
    ...product,
    name: edit.apiTitle || product.name,
    min_sku_original_price: price,
    priceRange: price > 0 ? formatUsd(price) : product.priceRange,
    estimatedRetailValue: price > 0
      ? price * product.sampleCount
      : product.estimatedRetailValue,
  };
}

export async function fetchSampleValuationWithEdits(): Promise<
  SampleValuation
> {
  const products = await fetchRecentProducts(1000);
  const store = await readStore();
  const samples = products
    .filter((product) => product.sampleCount > 0)
    .map((product) =>
      sampleFromProduct(product, store.edits[product.productId])
    );
  const totalSamples = samples.reduce(
    (sum, sample) => sum + sample.sampleCount,
    0,
  );
  const totalRetailValue = samples.reduce(
    (sum, sample) => sum + sample.sampleValue,
    0,
  );
  const lastUpdated =
    samples.map((sample) => sample.lastSeen).filter(Boolean).sort().at(-1) ||
    null;

  return {
    totalSamples,
    productsTracked: samples.length,
    totalRetailValue,
    averageSampleValue: totalSamples ? totalRetailValue / totalSamples : 0,
    maintainableMonthlyValue: Math.min(totalRetailValue, 5000),
    resale10Value: totalRetailValue * 0.1,
    resale20Value: totalRetailValue * 0.2,
    resale30Value: totalRetailValue * 0.3,
    lastUpdated,
  };
}

export async function fetchComparisonWithEdits(): Promise<ComparisonRow[]> {
  const products = await fetchRecentProducts(200);
  const store = await readStore();

  return products
    .map((product) => {
      const sample = sampleFromProduct(product, store.edits[product.productId]);
      const creatorVideos = product.creators || product.videos || 0;
      const platformVideos = product.videos || 0;
      const rank = product.categoryRank;

      return {
        productId: product.productId,
        name: sample.name,
        category: product.category,
        rank,
        creatorVideos,
        platformVideos,
        sales: product.gmv,
        min_sku_original_price: sample.price,
        sampleValue: sample.sampleValue,
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

function sampleFromProduct(
  product: ProductAnalysis,
  edit?: SamplePriceEdit,
): UnpricedSample {
  const price = edit?.price ?? product.min_sku_original_price;
  const sampleCount = edit?.sampleCount ?? product.sampleCount;

  return {
    productId: product.productId,
    name: edit?.apiTitle || product.name,
    originalPrice: product.min_sku_original_price,
    price,
    sampleCount,
    sampleValue: price * sampleCount,
    gmv: product.gmv,
    quantity: product.quantity,
    lastSeen: product.lastSeen,
    notes: edit?.notes || "",
    source: edit?.source || "graylog",
    sourceUrl: edit?.sourceUrl || null,
    apiTitle: edit?.apiTitle || null,
    apiSeller: edit?.apiSeller || null,
    fetchedAt: edit?.fetchedAt || null,
    updatedAt: edit?.updatedAt || null,
    priced: price > 0,
  };
}

function matchesQuery(sample: UnpricedSample, query: string): boolean {
  if (!query) return true;

  return sample.productId.toLowerCase().includes(query) ||
    sample.name.toLowerCase().includes(query) ||
    sample.notes.toLowerCase().includes(query);
}

async function fetchScrapeCreatorsPrice(
  product: ProductAnalysis,
): Promise<ScrapeCreatorsPrice> {
  const apiKey = envValue("SCRAPECREATORS_API_KEY") || envValue("API_KEY");
  if (!apiKey) throw new Error("SCRAPECREATORS_API_KEY is not configured");

  const base =
    (envValue("SCRAPECREATORS_API_BASE") || DEFAULT_SCRAPECREATORS_BASE)
      .replace(/\/+$/, "");
  const productUrl = tiktokProductUrl(product);
  const url = new URL(`${base}/v1/tiktok/product`);
  url.searchParams.set("url", productUrl);
  url.searchParams.set(
    "region",
    envValue("SCRAPECREATORS_REGION") || DEFAULT_REGION,
  );

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(
      `ScrapeCreators lookup failed: ${response.status} ${await response
        .text()}`,
    );
  }

  const body = await response.json();
  const price = priceFromScrapeCreators(body);

  return {
    price,
    sourceUrl: productUrl,
    title: stringAt(body, ["product_info", "product_base", "title"]) ||
      stringAt(body, ["product_base", "title"]),
    seller: stringAt(body, ["product_info", "seller", "name"]) ||
      stringAt(body, ["seller", "name"]) ||
      stringAt(body, ["shop_info", "shop_name"]),
  };
}

function priceFromScrapeCreators(body: unknown): number {
  const candidates = [
    valueAt(body, [
      "product_info",
      "product_base",
      "price",
      "min_sku_original_price",
    ]),
    valueAt(body, ["product_base", "price", "min_sku_original_price"]),
    valueAt(body, ["product_info", "product_base", "price", "min_sku_price"]),
    valueAt(body, ["product_base", "price", "min_sku_price"]),
    valueAt(body, ["product_info", "product_base", "price", "original_price"]),
    valueAt(body, ["product_base", "price", "original_price"]),
    valueAt(body, ["product_info", "product_base", "price", "real_price"]),
    valueAt(body, ["product_base", "price", "real_price"]),
    ...skuPriceCandidates(valueAt(body, ["product_info", "skus"])),
    ...skuPriceCandidates(valueAt(body, ["skus"])),
    valueAt(body, [
      "product_info",
      "product_base",
      "price",
      "max_sku_original_price",
    ]),
    valueAt(body, ["product_base", "price", "max_sku_original_price"]),
  ];

  for (const candidate of candidates) {
    const price = numberFrom(candidate, 0);
    if (price > 0) return price;
  }

  return 0;
}

function skuPriceCandidates(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((sku) => [
    valueAt(sku, ["price", "original_price_value"]),
    valueAt(sku, ["price", "original_price"]),
    valueAt(sku, ["price", "real_price", "price_val"]),
    valueAt(sku, ["price", "real_price", "price_str"]),
  ]);
}

async function readStore(): Promise<SampleStore> {
  try {
    const store = JSON.parse(await Deno.readTextFile(storePath()));
    if (
      store && typeof store === "object" && store.version === 1 &&
      isRecord(store.edits)
    ) {
      return store as SampleStore;
    }
  } catch {
    // Missing or malformed stores fall back to an empty edit map.
  }

  return { version: 1, edits: {} };
}

async function writeStore(store: SampleStore): Promise<void> {
  const path = storePath();
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(store, null, 2)}\n`);
}

function storePath(): string {
  return envValue("THIRSTY_SAMPLE_STORE") || DEFAULT_STORE_PATH;
}

function numericInput(value: unknown, label: string): number {
  const number = numberFrom(value, NaN);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid ${label}`);
  }
  return number;
}

function numberFrom(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
    .format(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function tiktokProductUrl(product: ProductAnalysis): string {
  return `https://www.tiktok.com/shop/pdp/${
    slug(product.name)
  }/${product.productId}`;
}

function slug(value: string): string {
  return value.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "product";
}

function valueAt(value: unknown, path: string[]): unknown {
  let current = value;

  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }

  return current;
}

function stringAt(value: unknown, path: string[]): string | undefined {
  const result = valueAt(value, path);
  return typeof result === "string" && result ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
