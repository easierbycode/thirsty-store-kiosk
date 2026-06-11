const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const defaultProductId = new URLSearchParams(location.search).get("product") ||
  "";

let currentProductId = "";

// Launch clean: never replay a remembered/browser-restored search, and put the
// cursor in the search box so the user can search or scan immediately. The
// product details stay hidden until a search/scan actually loads a product.
const globalQuery = document.getElementById("global-query");
globalQuery.value = "";
globalQuery.focus();

// The top bar toggles between Search (default) and Intake -- only one is shown.
const searchForm = document.getElementById("global-search");
const intakeForm = document.getElementById("sample-intake");
const intakeHint = document.getElementById("intake-result");
const modeSearchBtn = document.getElementById("mode-search");
const modeIntakeBtn = document.getElementById("mode-intake");

function setMode(mode) {
  const intake = mode === "intake";
  searchForm.classList.toggle("hidden", intake);
  intakeForm.classList.toggle("hidden", !intake);
  intakeHint.classList.toggle("hidden", !intake);
  modeSearchBtn.classList.toggle("active", !intake);
  modeIntakeBtn.classList.toggle("active", intake);
  (intake ? intakeForm.querySelector("input") : globalQuery).focus();
}

modeSearchBtn.addEventListener("click", () => setMode("search"));
modeIntakeBtn.addEventListener("click", () => setMode("intake"));

document.getElementById("global-search").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const query = document.getElementById("global-query").value.trim();
    // One search box: always filters the recovery queue; a bare numeric
    // product ID also loads that product's analysis up top.
    loadUnpricedSamples();
    if (/^\d{6,}$/.test(query)) loadProduct(query);
  },
);

document.getElementById("sample-intake").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  document.getElementById("intake-result").textContent = `Staged ${
    data.barcode || "sample"
  } for product ${data.productId || "unknown"} at ${
    data.location || "unassigned"
  }.`;
});

document.getElementById("unpriced-refresh").addEventListener("click", () => {
  loadUnpricedSamples();
});

document.getElementById("unpriced-rows").addEventListener(
  "click",
  async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const row = button.closest("[data-product-id]");
    if (!row) return;

    if (button.dataset.action === "save") {
      await saveUnpricedSample(row);
    } else if (button.dataset.action === "fetch-price") {
      await fetchUnpricedPrice(row);
    }
  },
);

await loadHealth();
await Promise.all([
  // Only load a product when explicitly deep-linked via ?product=; otherwise the
  // hero waits for a search instead of auto-showing the most recent product.
  defaultProductId ? loadProduct(defaultProductId) : Promise.resolve(),
  loadUnpricedSamples(),
  loadComparison(),
  loadKiosks(),
]);

setInterval(loadKiosks, 5000);

async function loadHealth() {
  const health = await json("/api/health");
  const warning = document.getElementById("setup-warning");

  if (!health.graylogConfigured) {
    warning.classList.remove("hidden");
    warning.textContent =
      "Graylog is not configured yet. Add GRAYLOG_URL plus GRAYLOG_TOKEN or GRAYLOG_USERNAME/GRAYLOG_PASSWORD in Deno Deploy.";
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

  currentProductId = product.productId;
  document.querySelector(".product-shell").classList.remove("hidden");
  document.getElementById("product-name").textContent = product.name;
  document.getElementById("product-meta").textContent =
    `${product.category} | ${product.seller} | Product ID ${product.productId} | ${product.priceRange}`;
  document.getElementById("min-price").textContent = money(
    product.min_sku_original_price,
  );
  document.getElementById("gmv").textContent = money(product.gmv);
  document.getElementById("customers").textContent = count(product.customers);
  document.getElementById("quantity").textContent = count(product.quantity);
  document.getElementById("sku-orders").textContent = count(product.skuOrders);
  document.getElementById("refunds").textContent = money(product.refunds);
  document.getElementById("units-refunded").textContent = count(
    product.unitsRefunded,
  );
  document.getElementById("videos").textContent = count(product.videos);
  document.getElementById("live-streams").textContent = count(
    product.liveStreams,
  );
}

async function loadUnpricedSamples() {
  const body = document.getElementById("unpriced-rows");
  const status = document.getElementById("unpriced-status");
  const summary = document.getElementById("unpriced-summary");
  const query = document.getElementById("global-query").value.trim();
  const params = new URLSearchParams({ limit: "150" });

  if (query) params.set("query", query);

  status.textContent = "Loading unpriced samples.";
  summary.textContent = "Loading";

  try {
    const data = await json(`/api/unpriced-samples?${params}`);
    summary.textContent = `${count(data.unpricedCount)} unpriced | ${
      count(data.pricedCount)
    } priced`;
    status.textContent = data.total
      ? `${count(data.items.length)} of ${count(data.total)} sample rows shown.`
      : "No unpriced samples matched this query.";
    body.innerHTML = data.items.length
      ? data.items.map(unpricedRowHtml).join("")
      : `<div class="empty-row">No unpriced samples found.</div>`;
  } catch (error) {
    status.textContent = error.message;
    summary.textContent = "Unavailable";
    body.innerHTML = `<div class="empty-row">${
      escapeHtml(error.message)
    }</div>`;
  }
}

async function saveUnpricedSample(row) {
  const productId = row.dataset.productId;
  const status = document.getElementById("unpriced-status");

  setRowBusy(row, true);
  status.textContent = `Saving ${productId}.`;

  try {
    await json(`/api/unpriced-samples/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        price: row.querySelector(".price-input").value,
        sampleCount: row.querySelector(".sample-count-input").value,
        notes: row.querySelector(".notes-input").value,
      }),
    });
    status.textContent = `Saved ${productId}.`;
    await refreshAfterPriceChange(productId);
  } catch (error) {
    status.textContent = error.message;
    showNotice(error.message);
  } finally {
    setRowBusy(row, false);
  }
}

async function fetchUnpricedPrice(row) {
  const productId = row.dataset.productId;
  const status = document.getElementById("unpriced-status");

  setRowBusy(row, true);
  status.textContent = `Looking up the live price for ${productId}.`;

  let fetched;
  try {
    fetched = await json(
      `/api/unpriced-samples/${encodeURIComponent(productId)}/fetch-price`,
      { method: "POST" },
    );
  } catch (error) {
    status.textContent = error.message;
    showNotice(error.message);
    setRowBusy(row, false);
    return;
  }

  // The lookup only proposes a price -- preview it in the row, then offer to save.
  const priceInput = row.querySelector(".price-input");
  if (priceInput) priceInput.value = priceInputValue(fetched.price);
  status.textContent = `Found ${money(fetched.price)} for ${fetched.name}.`;

  if (
    !confirm(
      `Found ${money(fetched.price)} for ${fetched.name}. Save this price?`,
    )
  ) {
    status.textContent = `Discarded looked-up price for ${productId}.`;
    await loadUnpricedSamples();
    setRowBusy(row, false);
    return;
  }

  try {
    await json(`/api/unpriced-samples/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        price: fetched.price,
        source: "scrapecreators",
        sourceUrl: fetched.sourceUrl,
        apiTitle: fetched.apiTitle,
        apiSeller: fetched.apiSeller,
        fetchedAt: fetched.fetchedAt,
      }),
    });
    status.textContent = `Saved ${money(fetched.price)} for ${productId}.`;
    await refreshAfterPriceChange(productId);
  } catch (error) {
    status.textContent = error.message;
    showNotice(error.message);
  } finally {
    setRowBusy(row, false);
  }
}

async function refreshAfterPriceChange(productId) {
  const tasks = [loadUnpricedSamples(), loadComparison()];
  if (productId && productId === currentProductId) {
    tasks.push(loadProduct(productId));
  }
  await Promise.all(tasks);
}

function unpricedRowHtml(sample) {
  const lastSeen = sample.lastSeen
    ? new Date(sample.lastSeen).toLocaleDateString()
    : "No timestamp";
  const fetchedAt = sample.fetchedAt
    ? ` · Looked up ${new Date(sample.fetchedAt).toLocaleDateString()}`
    : "";
  const source = sourceLabel(sample.source);
  const canFetch = Number(sample.price || 0) <= 0;

  return `
    <div class="sample-row" data-product-id="${escapeAttr(sample.productId)}">
      <div class="cell product-cell">
        <p class="row-title" title="${escapeAttr(sample.name)}">${
    escapeHtml(sample.name)
  }</p>
        <p class="row-sub">
          <span class="source-tag ${sourceClass(sample.source)}">${
    escapeHtml(source)
  }</span>
          <span>ID ${escapeHtml(sample.productId)}</span>
          <span>${escapeHtml(lastSeen)}${escapeHtml(fetchedAt)}</span>
        </p>
      </div>
      <div class="cell">
        <span class="m-label">Price</span>
        <input class="price-input tnum" type="number" min="0" step="0.01" placeholder="0.00" value="${
    escapeAttr(priceInputValue(sample.price))
  }">
        <span class="cell-hint tnum">Graylog ${
    money(sample.originalPrice)
  }</span>
      </div>
      <div class="cell">
        <span class="m-label">Samples</span>
        <input class="sample-count-input tnum" type="number" min="0" step="1" value="${
    escapeAttr(sample.sampleCount)
  }">
      </div>
      <div class="cell">
        <span class="m-label">Value</span>
        <span class="row-value tnum">${money(sample.sampleValue)}</span>
      </div>
      <div class="cell notes-cell">
        <span class="m-label">Notes</span>
        <input class="notes-input" value="${
    escapeAttr(sample.notes)
  }" placeholder="Notes">
      </div>
      <div class="cell row-actions">
        <button class="small" type="button" data-action="fetch-price" ${
    canFetch ? "" : "disabled"
  }>Look Up Price</button>
        <button class="small ghost" type="button" data-action="save">Save</button>
      </div>
    </div>
  `;
}

async function loadComparison() {
  const rows = await json("/api/comparison");
  const body = document.getElementById("comparison-rows");

  body.innerHTML = rows.length
    ? rows.map((row) => `
    <div class="cmp-row">
      <div class="cell product-cell">
        <p class="row-title" title="${escapeAttr(row.name)}">${
      escapeHtml(row.name)
    }</p>
        <p class="row-sub"><span>${
      escapeHtml(row.category || "Uncategorized")
    }</span></p>
      </div>
      <div class="cell num"><span class="m-label">Rank</span>${
      row.rank ? `#${count(row.rank)}` : "-"
    }</div>
      <div class="cell num"><span class="m-label">Creator videos</span>${
      count(row.creatorVideos)
    }</div>
      <div class="cell num"><span class="m-label">Platform videos</span>${
      count(row.platformVideos)
    }</div>
      <div class="cell num tnum"><span class="m-label">Sales</span>${
      money(row.sales)
    }</div>
      <div class="cell num tnum"><span class="m-label">Sample value</span>${
      money(row.sampleValue)
    }</div>
      <div class="cell"><span class="signal ${signalClass(row.signal)}">${
      escapeHtml(row.signal)
    }</span></div>
    </div>
  `).join("")
    : `<div class="empty-row">No comparison rows found in Graylog yet.</div>`;
}

async function loadKiosks() {
  const kiosks = await json("/api/kiosks");
  const root = document.getElementById("kiosks");

  root.innerHTML = kiosks.length
    ? kiosks.map((kiosk) => `
    <article class="kiosk">
      <strong>${escapeHtml(kiosk.id)}</strong>
      <p class="status ${kiosk.online ? "" : "off"}">${
      kiosk.disabled ? "DISABLED" : kiosk.online ? "ONLINE" : "OFFLINE"
    }</p>
      <p class="muted">Last seen ${
      kiosk.lastSeen ? new Date(kiosk.lastSeen).toLocaleString() : "never"
    }</p>
      <button class="small ghost" onclick="disableKiosk('${
      escapeAttr(kiosk.id)
    }')">Disable</button>
    </article>
  `).join("")
    : `<p class="muted">No kiosk heartbeats yet.</p>`;
}

window.disableKiosk = async (id) => {
  await fetch(`/api/kiosks/${encodeURIComponent(id)}/disable`, {
    method: "POST",
  });
  await loadKiosks();
};

async function json(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { "content-type": "application/json" } : undefined,
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Request failed: ${path}`);
  return data;
}

function setRowBusy(row, busy) {
  for (const control of row.querySelectorAll("button, input")) {
    control.disabled = busy;
  }
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

function priceInputValue(value) {
  const number = Number(value || 0);
  return number > 0 ? number.toFixed(2) : "";
}

function sourceLabel(value) {
  if (value === "scrapecreators") return "API";
  if (value === "extension") return "Extension";
  if (value === "manual") return "Manual";
  return "Graylog";
}

function sourceClass(value) {
  if (value === "scrapecreators") return "api";
  if (value === "extension") return "api";
  if (value === "manual") return "manual";
  return "graylog";
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
