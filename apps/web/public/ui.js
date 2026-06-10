const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const defaultProductId = new URLSearchParams(location.search).get("product") || "";

document.getElementById("product-id").value = defaultProductId;
document.getElementById("product-search").addEventListener("submit", (event) => {
  event.preventDefault();
  const productId = new FormData(event.currentTarget).get("productId")?.toString().trim();
  if (productId) loadProduct(productId);
});

document.getElementById("sample-intake").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  document.getElementById("intake-result").textContent =
    `Staged ${data.barcode || "sample"} for product ${data.productId || "unknown"} at ${data.location || "unassigned"}.`;
});

await loadHealth();
await Promise.all([
  defaultProductId ? loadProduct(defaultProductId) : loadProductsFallback(),
  loadValuation(),
  loadComparison(),
  loadKiosks(),
]);

setInterval(loadKiosks, 5000);

async function loadHealth() {
  const health = await json("/api/health");
  const warning = document.getElementById("setup-warning");

  if (!health.graylogConfigured) {
    warning.classList.remove("hidden");
    warning.textContent = "Graylog is not configured yet. Add GRAYLOG_URL plus GRAYLOG_TOKEN or GRAYLOG_USERNAME/GRAYLOG_PASSWORD in Deno Deploy.";
  }
}

async function loadProductsFallback() {
  const products = await json("/api/products?limit=1");
  if (products[0]?.productId) {
    document.getElementById("product-id").value = products[0].productId;
    await loadProduct(products[0].productId);
  }
}

async function loadProduct(productId) {
  let product;
  try {
    product = await json(`/api/product/${encodeURIComponent(productId)}`);
  } catch (error) {
    showNotice(error.message);
    return;
  }

  document.getElementById("product-name").textContent = product.name;
  document.getElementById("product-meta").textContent =
    `${product.category} | ${product.seller} | Product ID ${product.productId} | ${product.priceRange}`;
  document.getElementById("min-price").textContent = money(product.min_sku_original_price);
  document.getElementById("gmv").textContent = money(product.gmv);
  document.getElementById("customers").textContent = count(product.customers);
  document.getElementById("quantity").textContent = count(product.quantity);
  document.getElementById("sku-orders").textContent = count(product.skuOrders);
  document.getElementById("refunds").textContent = money(product.refunds);
  document.getElementById("units-refunded").textContent = count(product.unitsRefunded);
  document.getElementById("videos").textContent = count(product.videos);
  document.getElementById("live-streams").textContent = count(product.liveStreams);
}

async function loadValuation() {
  const valuation = await json("/api/sample-valuation");

  document.getElementById("total-retail").textContent = money(valuation.totalRetailValue);
  document.getElementById("total-samples").textContent = count(valuation.totalSamples);
  document.getElementById("average-sample").textContent = money(valuation.averageSampleValue);
  document.getElementById("monthly-value").textContent = money(valuation.maintainableMonthlyValue);
  document.getElementById("resale-10").textContent = money(valuation.resale10Value);
  document.getElementById("resale-20").textContent = money(valuation.resale20Value);
  document.getElementById("resale-30").textContent = money(valuation.resale30Value);
  document.getElementById("valuation-updated").textContent =
    valuation.lastUpdated ? `Updated ${new Date(valuation.lastUpdated).toLocaleString()}` : "No data yet";
}

async function loadComparison() {
  const rows = await json("/api/comparison");
  const body = document.getElementById("comparison-rows");

  body.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name)}<br><span class="muted">${escapeHtml(row.category || "Uncategorized")}</span></td>
      <td>${row.rank ? `#${count(row.rank)}` : "-"}</td>
      <td>${count(row.creatorVideos)}</td>
      <td>${count(row.platformVideos)}</td>
      <td>${money(row.sales)}</td>
      <td>${money(row.sampleValue)}</td>
      <td><span class="signal ${signalClass(row.signal)}">${escapeHtml(row.signal)}</span></td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="muted">No comparison rows found in Graylog yet.</td></tr>`;
}

async function loadKiosks() {
  const kiosks = await json("/api/kiosks");
  const root = document.getElementById("kiosks");

  root.innerHTML = kiosks.length ? kiosks.map((kiosk) => `
    <article class="kiosk">
      <strong>${escapeHtml(kiosk.id)}</strong>
      <p class="status ${kiosk.online ? "" : "off"}">${kiosk.disabled ? "DISABLED" : kiosk.online ? "ONLINE" : "OFFLINE"}</p>
      <p class="muted">Last seen ${kiosk.lastSeen ? new Date(kiosk.lastSeen).toLocaleString() : "never"}</p>
      <button onclick="disableKiosk('${escapeAttr(kiosk.id)}')">Disable</button>
    </article>
  `).join("") : `<p class="muted">No kiosk heartbeats yet.</p>`;
}

window.disableKiosk = async (id) => {
  await fetch(`/api/kiosks/${encodeURIComponent(id)}/disable`, { method: "POST" });
  await loadKiosks();
};

async function json(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${path}`);
  return data;
}

function showNotice(message) {
  const warning = document.getElementById("setup-warning");
  warning.classList.remove("hidden");
  warning.textContent = message;
}

function money(value) {
  return currency.format(Number(value || 0));
}

function count(value) {
  return integer.format(Number(value || 0));
}

function signalClass(signal) {
  if (signal === "Under-posted") return "good";
  if (signal === "Priority") return "hot";
  return "watch";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
