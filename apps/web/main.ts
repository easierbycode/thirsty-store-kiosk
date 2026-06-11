import { fromFileUrl, join } from "https://deno.land/std/path/mod.ts";
import {
  envValue,
  fetchRecentProducts,
  graylogConfigFromEnv,
} from "./core/graylog.ts";
import {
  fetchComparisonWithEdits,
  fetchPriceForSample,
  fetchProductWithEdits,
  fetchSampleValuationWithEdits,
  listUnpricedSamples,
  updateSamplePrice,
} from "./core/samples.ts";

const ROOT = fromFileUrl(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const kiosks = new Map<string, { lastSeen: number; disabled: boolean }>();

export function startWebApp(
  options: Deno.ServeTcpOptions = {},
): Deno.HttpServer {
  return Deno.serve(options, handleRequest);
}

if (import.meta.main) {
  startWebApp();
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  try {
    if (url.pathname === "/api/health") {
      const graylog = graylogConfigFromEnv();
      return Response.json({
        ok: true,
        graylogConfigured: Boolean(graylog),
        graylogStreamId: graylog?.streamId || null,
        graylogRangeSeconds: graylog?.rangeSeconds || null,
        scrapeCreatorsConfigured: Boolean(
          envValue("SCRAPECREATORS_API_KEY") || envValue("API_KEY"),
        ),
      });
    }

    if (url.pathname === "/api/heartbeat") {
      const id = req.headers.get("x-kiosk-id") || "unknown";
      const existing = kiosks.get(id);
      kiosks.set(id, {
        lastSeen: Date.now(),
        disabled: existing?.disabled || false,
      });
      return Response.json({
        ok: true,
        disabled: kiosks.get(id)?.disabled || false,
      });
    }

    if (url.pathname === "/api/kiosks") {
      return Response.json([...kiosks.entries()].map(([id, kiosk]) => ({
        id,
        lastSeen: kiosk.lastSeen,
        online: !kiosk.disabled && Date.now() - kiosk.lastSeen < 15000,
        disabled: kiosk.disabled,
      })));
    }

    if (
      url.pathname.startsWith("/api/kiosks/") &&
      url.pathname.endsWith("/disable")
    ) {
      const id = url.pathname.split("/")[3];
      const existing = kiosks.get(id);
      kiosks.set(id, { lastSeen: existing?.lastSeen || 0, disabled: true });
      return Response.json({ ok: true, id, disabled: true });
    }

    if (
      url.pathname.startsWith("/api/kiosks/") &&
      url.pathname.endsWith("/enable")
    ) {
      const id = url.pathname.split("/")[3];
      const existing = kiosks.get(id);
      kiosks.set(id, {
        lastSeen: existing?.lastSeen || Date.now(),
        disabled: false,
      });
      return Response.json({ ok: true, id, disabled: false });
    }

    if (url.pathname.startsWith("/api/product/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() || "");
      const product = await fetchProductWithEdits(id);
      if (!product) return jsonError("Product not found in Graylog", 404);
      return Response.json(product);
    }

    if (url.pathname === "/api/products") {
      return Response.json(
        await fetchRecentProducts(Number(url.searchParams.get("limit") || 100)),
      );
    }

    if (url.pathname === "/api/unpriced-samples") {
      return Response.json(
        await listUnpricedSamples(
          url.searchParams.get("query") || "",
          Number(url.searchParams.get("limit") || 100),
        ),
      );
    }

    const unpricedMatch = url.pathname.match(
      /^\/api\/unpriced-samples\/([^/]+)$/,
    );
    if (unpricedMatch) {
      if (req.method !== "PATCH") return jsonError("Method not allowed", 405);
      return Response.json(
        await updateSamplePrice(
          decodeURIComponent(unpricedMatch[1]),
          await readJsonBody(req),
        ),
      );
    }

    const fetchPriceMatch = url.pathname.match(
      /^\/api\/unpriced-samples\/([^/]+)\/fetch-price$/,
    );
    if (fetchPriceMatch) {
      if (req.method !== "POST") return jsonError("Method not allowed", 405);
      return Response.json(
        await fetchPriceForSample(decodeURIComponent(fetchPriceMatch[1])),
      );
    }

    if (url.pathname === "/api/comparison") {
      return Response.json(await fetchComparisonWithEdits());
    }

    if (url.pathname === "/api/sample-valuation") {
      return Response.json(await fetchSampleValuationWithEdits());
    }

    if (url.pathname === "/") {
      return staticFile("index.html", "text/html");
    }

    if (url.pathname === "/ui.js") {
      return staticFile("ui.js", "text/javascript");
    }

    if (url.pathname === "/styles.css") {
      return staticFile("styles.css", "text/css");
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message, 500);
  }
}

async function staticFile(
  name: string,
  contentType: string,
): Promise<Response> {
  return new Response(await Deno.readTextFile(join(PUBLIC, name)), {
    headers: { "content-type": contentType },
  });
}

function jsonError(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, { status });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
