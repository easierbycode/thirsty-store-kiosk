import { dirname } from "https://deno.land/std/path/mod.ts";
import {
  type ComparisonRow,
  envValue,
  fetchProductAnalysis,
  fetchRecentProducts,
  fetchSampleEditRecords,
  type ProductAnalysis,
  type SampleValuation,
  sendGelfMessage,
} from "./graylog.ts";

export type SamplePriceEdit = {
  productId: string;
  price: number;
  sampleCount?: number;
  notes?: string;
  source: "manual" | "scrapecreators" | "extension";
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
  image: string | null;
  persistedTo?: string[];
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
  products: Record<string, ProductAnalysis>;
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

type SampleProductInput = SampleUpdateInput & {
  productId?: unknown;
  name?: unknown;
  category?: unknown;
  seller?: unknown;
  sourceUrl?: unknown;
  lastSeen?: unknown;
  image?: unknown;
};

type ScrapeCreatorsPrice = {
  price: number;
  sourceUrl: string;
  title?: string;
  seller?: string;
  image?: string;
  product?: Record<string, unknown>;
};

const DEFAULT_STORE_PATH = ".thirsty/sample-prices.json";
const DEFAULT_SCRAPECREATORS_BASE = "https://api.scrapecreators.com";
const DEFAULT_REGION = "US";

export async function listUnpricedSamples(
  query = "",
  limit = 100,
): Promise<UnpricedSampleList> {
  const store = await loadStore();
  const products = await fetchProductsWithStored(1000, store);
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
  const store = await loadStore();
  const products = await fetchProductsWithStored(1000, store);
  const product = products.find((item) => item.productId === productId);
  if (!product) {
    throw new Error(`Product ${productId} was not found in Graylog`);
  }

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
  const edit = store.edits[productId];
  const persistedTo = await persistStore(store, {
    shortMessage: `thirsty sample price: ${product.name}`,
    fields: {
      sample_source: edit.source,
      sample_edit_json: JSON.stringify(edit),
    },
  });

  return { ...sampleFromProduct(product, edit), persistedTo };
}

export async function upsertSampleProduct(
  input: SampleProductInput,
): Promise<UnpricedSample> {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Product name is required");

  const store = await loadStore();
  const productId = String(input.productId || stableProductId(name)).trim();
  const existingProduct = store.products[productId];
  const existingEdit = store.edits[productId];
  const now = new Date().toISOString();
  const price = input.price === undefined
    ? existingEdit?.price ?? existingProduct?.min_sku_original_price ?? 0
    : numericInput(input.price, "price");
  const sampleCount = input.sampleCount === undefined
    ? existingEdit?.sampleCount ?? existingProduct?.sampleCount ?? 1
    : numericInput(input.sampleCount, "sample count");
  const notes = input.notes === undefined
    ? existingEdit?.notes
    : String(input.notes || "").trim();
  const sourceUrl = optionalString(input.sourceUrl) ??
    existingEdit?.sourceUrl;
  const seller = optionalString(input.apiSeller) ??
    optionalString(input.seller) ??
    existingProduct?.seller ?? "Extension";
  const category = optionalString(input.category) ??
    existingProduct?.category ??
    "Samples";
  const lastSeen = optionalString(input.lastSeen) ??
    existingProduct?.lastSeen ?? now;
  const image = optionalString(input.image) ?? existingProduct?.image ?? null;

  store.products[productId] = {
    productId,
    name,
    priceRange: price > 0 ? formatUsd(price) : "Unknown",
    min_sku_original_price: 0,
    category,
    categoryRank: existingProduct?.categoryRank ?? null,
    seller,
    creators: existingProduct?.creators ?? 0,
    liveStreams: existingProduct?.liveStreams ?? 0,
    videos: existingProduct?.videos ?? 0,
    gmv: existingProduct?.gmv ?? 0,
    customers: existingProduct?.customers ?? 0,
    quantity: existingProduct?.quantity ?? 0,
    skuOrders: existingProduct?.skuOrders ?? 0,
    refunds: existingProduct?.refunds ?? 0,
    unitsRefunded: existingProduct?.unitsRefunded ?? 0,
    sampleCount,
    estimatedRetailValue: price * sampleCount,
    lastSeen,
    image,
  };

  if (price > 0) {
    store.edits[productId] = {
      productId,
      price,
      sampleCount,
      notes,
      source: "extension",
      sourceUrl,
      apiTitle: name,
      apiSeller: seller,
      fetchedAt: optionalString(input.fetchedAt) ?? existingEdit?.fetchedAt ??
        now,
      updatedAt: now,
    };
  }

  // The product row goes out as core_data_json so the regular Graylog product
  // pipeline picks it up (the price stays on the edit, keeping the row in the
  // recovery queue with its Extension source tag, same as the local store).
  const gelfFields: Record<string, unknown> = {
    sample_source: "extension",
    core_data_json: JSON.stringify({
      productId,
      name,
      min_sku_original_price: 0,
      sample_count: sampleCount,
      category,
      seller,
      image,
      estimated_retail_value: price * sampleCount,
      scrapedAt: optionalString(input.fetchedAt) ?? now,
    }),
  };
  if (store.edits[productId]) {
    gelfFields.sample_edit_json = JSON.stringify(store.edits[productId]);
  }
  const persistedTo = await persistStore(store, {
    shortMessage: `thirsty sample product: ${name}`,
    fields: gelfFields,
  });

  return {
    ...sampleFromProduct(store.products[productId], store.edits[productId]),
    persistedTo,
  };
}

export async function fetchPriceForSample(
  productId: string,
): Promise<UnpricedSample> {
  const store = await loadStore();
  const products = await fetchProductsWithStored(1000, store);
  const product = products.find((item) => item.productId === productId);
  if (!product) {
    throw new Error(`Product ${productId} was not found in Graylog`);
  }

  const lookup = await fetchScrapeCreatorsPrice(product);
  if (lookup.price <= 0) {
    throw new Error("ScrapeCreators returned no usable price");
  }

  const now = new Date().toISOString();

  // The lookup response is the only place the entire product (title, seller,
  // images, skus) ever appears, so persist all of it right away -- otherwise
  // the data is gone the moment the user dismisses the price confirm. The
  // price itself still goes through the preview/confirm flow below; the saved
  // product row keeps its original price so the sample stays in the queue.
  const enriched: ProductAnalysis = {
    ...product,
    name: lookup.title || product.name,
    seller: lookup.seller || product.seller,
    image: lookup.image ?? product.image ?? null,
    lastSeen: now,
  };
  store.products[productId] = enriched;
  let persistedTo: string[] = [];
  try {
    persistedTo = await persistStore(store, {
      shortMessage: `thirsty product lookup: ${enriched.name}`,
      fields: {
        sample_source: "scrapecreators",
        product_json: scrapeCreatorsProductJson(lookup.product),
        core_data_json: JSON.stringify({
          productId,
          name: enriched.name,
          min_sku_original_price: product.min_sku_original_price,
          sample_count: enriched.sampleCount,
          category: enriched.category,
          seller: enriched.seller,
          image: enriched.image,
          estimated_retail_value: enriched.estimatedRetailValue,
          scrapedAt: now,
        }),
      },
    });
  } catch {
    // A failed product save must not eat the looked-up price -- the client
    // can still preview it and confirm, which persists via updateSamplePrice.
  }

  const existing = store.edits[productId];
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

  return { ...sampleFromProduct(enriched, proposed), persistedTo };
}

// Catalog endpoint used by sibling apps (sample tracker, thirsty.store). The
// local/recovered store keeps serving products even when Graylog is offline.
export async function listProducts(limit = 100): Promise<ProductAnalysis[]> {
  const store = await loadStore();
  let recent: ProductAnalysis[] = [];
  try {
    recent = await fetchRecentProducts(limit);
  } catch {
    // Graylog being unreachable must not take the catalog down -- the store
    // still has every product saved by lookups and intake.
  }

  const products = new Map<string, ProductAnalysis>();
  for (const product of recent) {
    products.set(product.productId, product);
  }
  for (const product of Object.values(store.products)) {
    if (!products.has(product.productId)) {
      products.set(product.productId, product);
    }
  }

  return [...products.values()]
    .map((product) => productWithEdit(product, store.edits[product.productId]))
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, limit);
}

export async function fetchProductWithEdits(
  productId: string,
): Promise<ProductAnalysis | null> {
  const store = await loadStore();
  const product = await fetchProductAnalysis(productId) ??
    store.products[productId];
  if (!product) return null;

  // The product-detail view reads raw Graylog data, so a price recovered via
  // Save or Fetch API (stored as an edit) would otherwise never show here even
  // though the sample queue reflects it. Apply the edit so both views agree.
  return productWithEdit(product, store.edits[productId]);
}

function productWithEdit(
  product: ProductAnalysis,
  edit?: SamplePriceEdit,
): ProductAnalysis {
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
  const store = await loadStore();
  const products = await fetchProductsWithStored(1000, store);
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
  const store = await loadStore();
  const products = await fetchProductsWithStored(200, store);

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
    image: product.image ?? null,
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
  const region = envValue("SCRAPECREATORS_REGION") || DEFAULT_REGION;

  if (product.productId.startsWith("9")) {
    return fetchScrapeCreatorsPriceByName(base, apiKey, region, product);
  }

  return fetchScrapeCreatorsPriceByUrl(base, apiKey, region, product);
}

async function fetchScrapeCreatorsPriceByUrl(
  base: string,
  apiKey: string,
  region: string,
  product: ProductAnalysis,
): Promise<ScrapeCreatorsPrice> {
  const productUrl = tiktokProductUrl(product);
  const url = new URL(`${base}/v1/tiktok/product`);
  url.searchParams.set("url", productUrl);
  url.searchParams.set("region", region);

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
    image: imageFromScrapeCreators(body),
    product: isRecord(body) ? body : undefined,
  };
}

async function fetchScrapeCreatorsPriceByName(
  base: string,
  apiKey: string,
  region: string,
  product: ProductAnalysis,
): Promise<ScrapeCreatorsPrice> {
  const url = new URL(`${base}/v1/tiktok/shop/search`);
  url.searchParams.set("query", product.name);
  url.searchParams.set("region", region);

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(
      `ScrapeCreators name lookup failed: ${response.status} ${await response
        .text()}`,
    );
  }

  const body = await response.json();
  const result = bestScrapeCreatorsSearchProduct(body, product.name);
  if (!result) {
    return {
      price: 0,
      sourceUrl: url.href,
    };
  }

  return {
    price: priceFromScrapeCreatorsSearchProduct(result),
    sourceUrl: scrapeCreatorsSearchProductUrl(result) || url.href,
    title: scrapeCreatorsSearchProductTitle(result),
    seller: scrapeCreatorsSearchProductSeller(result),
    image: imageFromScrapeCreators(result),
    product: result,
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

function bestScrapeCreatorsSearchProduct(
  body: unknown,
  query: string,
): Record<string, unknown> | null {
  const products = scrapeCreatorsSearchProducts(body);
  let best: Record<string, unknown> | null = null;
  let bestScore = -Infinity;

  for (const product of products) {
    if (priceFromScrapeCreatorsSearchProduct(product) <= 0) continue;

    const score = searchProductScore(
      query,
      scrapeCreatorsSearchProductTitle(product) || "",
    );
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }

  return best;
}

function scrapeCreatorsSearchProducts(
  body: unknown,
): Record<string, unknown>[] {
  const candidates = [
    valueAt(body, ["products"]),
    valueAt(body, ["data", "products"]),
    valueAt(body, ["items"]),
    valueAt(body, ["data", "items"]),
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }

  return [];
}

function searchProductScore(query: string, title: string): number {
  const normalizedQuery = searchText(query);
  const normalizedTitle = searchText(title);
  if (!normalizedQuery || !normalizedTitle) return 0;
  if (normalizedTitle === normalizedQuery) return 1000;
  if (normalizedTitle.includes(normalizedQuery)) return 800;
  if (normalizedQuery.includes(normalizedTitle)) return 700;

  const queryTerms = new Set(normalizedQuery.split(" ").filter(Boolean));
  const titleTerms = new Set(normalizedTitle.split(" ").filter(Boolean));
  let shared = 0;
  for (const term of queryTerms) {
    if (titleTerms.has(term)) shared++;
  }

  return shared / Math.max(queryTerms.size, 1);
}

function searchText(value: string): string {
  return value.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function priceFromScrapeCreatorsSearchProduct(product: unknown): number {
  const candidates = [
    valueAt(product, ["price"]),
    valueAt(product, ["sale_price"]),
    valueAt(product, ["original_price"]),
    valueAt(product, ["product_price_info", "sale_price_decimal"]),
    valueAt(product, ["product_price_info", "sale_price_format"]),
    valueAt(product, ["product_price_info", "single_product_price_decimal"]),
    valueAt(product, ["product_price_info", "single_product_price_format"]),
    valueAt(product, ["product_price_info", "original_price"]),
    valueAt(product, ["product_price_info", "original_price_value"]),
  ];

  for (const candidate of candidates) {
    const price = numberFrom(candidate, 0);
    if (price > 0) return price;
  }

  return 0;
}

function scrapeCreatorsSearchProductTitle(
  product: unknown,
): string | undefined {
  return stringAt(product, ["title"]) ||
    stringAt(product, ["name"]) ||
    stringAt(product, ["product_name"]);
}

function scrapeCreatorsSearchProductSeller(
  product: unknown,
): string | undefined {
  return stringAt(product, ["seller_info", "shop_name"]) ||
    stringAt(product, ["shop_name"]) ||
    stringAt(product, ["seller", "name"]);
}

function scrapeCreatorsSearchProductUrl(product: unknown): string | undefined {
  return stringAt(product, ["url"]) ||
    stringAt(product, ["seo_url", "canonical_url"]) ||
    stringAt(product, ["canonical_url"]);
}

// Works for both response shapes: the product endpoint nests image objects
// (url_list/thumb_url_list) under product_base, while search results carry
// flat cover/img fields.
function imageFromScrapeCreators(body: unknown): string | undefined {
  const candidates = [
    valueAt(body, ["product_info", "product_base", "images"]),
    valueAt(body, ["product_base", "images"]),
    valueAt(body, ["product_info", "images"]),
    valueAt(body, ["images"]),
    valueAt(body, ["cover"]),
    valueAt(body, ["cover_url"]),
    valueAt(body, ["img"]),
    valueAt(body, ["image"]),
    valueAt(body, ["thumbnail"]),
  ];

  for (const candidate of candidates) {
    const url = firstImageUrl(candidate);
    if (url) return url;
  }

  return undefined;
}

function firstImageUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return /^https?:\/\//.test(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstImageUrl(item);
      if (url) return url;
    }
    return undefined;
  }
  if (isRecord(value)) {
    return firstImageUrl(value.url_list) ??
      firstImageUrl(value.thumb_url_list) ??
      firstImageUrl(value.url) ??
      firstImageUrl(value.uri);
  }
  return undefined;
}

// Graylog indexes each GELF field, and oversized values can fail to index --
// ship the entire payload when it fits, otherwise keep the sections that
// matter (identity, pricing, images, seller) so the save never fails.
function scrapeCreatorsProductJson(
  product: Record<string, unknown> | undefined,
): string | undefined {
  if (!product) return undefined;

  const full = JSON.stringify(product);
  if (full.length <= 30000) return full;

  const compact: Record<string, unknown> = {};
  for (
    const key of [
      "product_base",
      "product_info",
      "skus",
      "seller",
      "seller_info",
      "shop_info",
      "seo_url",
      "title",
      "name",
      "price",
      "product_price_info",
      "cover",
      "img",
      "image",
      "images",
      "url",
    ]
  ) {
    if (product[key] !== undefined) compact[key] = product[key];
  }
  const compactJson = JSON.stringify(compact);
  if (compactJson.length <= 30000) return compactJson;

  return JSON.stringify({ truncated: true, keys: Object.keys(product) });
}

async function readStore(): Promise<SampleStore> {
  try {
    const store = JSON.parse(await Deno.readTextFile(storePath()));
    if (
      store && typeof store === "object" && store.version === 1 &&
      isRecord(store.edits)
    ) {
      return {
        version: 1,
        edits: store.edits,
        products: isRecord(store.products) ? store.products : {},
      } as SampleStore;
    }
  } catch {
    // Missing or malformed stores fall back to an empty edit map.
  }

  return { version: 1, edits: {}, products: {} };
}

async function writeStore(store: SampleStore): Promise<void> {
  const path = storePath();
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(store, null, 2)}\n`);
}

function storePath(): string {
  return envValue("THIRSTY_SAMPLE_STORE") || DEFAULT_STORE_PATH;
}

// The local JSON store is wiped whenever the deployed app restarts, so the
// durable copy of every price edit lives in Graylog (sample_edit_json
// messages). Reads merge both, newest updatedAt per product winning.
async function loadStore(): Promise<SampleStore> {
  const store = await readStore();

  for (const record of await fetchSampleEditRecords()) {
    const edit = editFromRecord(record);
    if (!edit) continue;

    const existing = store.edits[edit.productId];
    if (!existing || edit.updatedAt > (existing.updatedAt || "")) {
      store.edits[edit.productId] = edit;
    }
  }

  return store;
}

function editFromRecord(
  record: Record<string, unknown>,
): SamplePriceEdit | null {
  const productId = String(record.productId || "").trim();
  const price = numberFrom(record.price, NaN);
  if (!productId || !Number.isFinite(price) || price < 0) return null;

  const sampleCount = numberFrom(record.sampleCount, NaN);
  const source = record.source === "scrapecreators" ||
      record.source === "extension"
    ? record.source
    : "manual";

  return {
    productId,
    price,
    sampleCount: Number.isFinite(sampleCount) ? sampleCount : undefined,
    notes: optionalString(record.notes),
    source,
    sourceUrl: optionalString(record.sourceUrl),
    apiTitle: optionalString(record.apiTitle),
    apiSeller: optionalString(record.apiSeller),
    fetchedAt: optionalString(record.fetchedAt),
    updatedAt: optionalString(record.updatedAt) || "",
  };
}

type GelfRecord = {
  shortMessage: string;
  fields: Record<string, unknown>;
};

// Persist everywhere we can reach: the local file (fast reads in dev, but
// read-only or ephemeral once deployed) and Graylog (durable). Only when
// neither accepts the write did the save actually fail.
async function persistStore(
  store: SampleStore,
  gelf: GelfRecord,
): Promise<string[]> {
  const targets: string[] = [];

  try {
    await writeStore(store);
    targets.push("file");
  } catch {
    // Expected on deployed read-only filesystems; Graylog is the durable copy.
  }

  if (await sendGelfMessage(gelf.shortMessage, gelf.fields)) {
    targets.push("graylog");
  }

  if (!targets.length) {
    throw new Error(
      "Could not persist sample data to the local store or Graylog",
    );
  }

  return targets;
}

async function fetchProductsWithStored(
  limit: number,
  store: SampleStore,
): Promise<ProductAnalysis[]> {
  const products = new Map<string, ProductAnalysis>();

  for (const product of await fetchRecentProducts(limit)) {
    products.set(product.productId, product);
  }

  for (const product of Object.values(store.products)) {
    products.set(product.productId, products.get(product.productId) ?? product);
  }

  return [...products.values()]
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, limit);
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

function stableProductId(name: string): string {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `900${String(hash >>> 0).padStart(10, "0")}`;
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
