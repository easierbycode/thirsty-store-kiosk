import { join, fromFileUrl } from "https://deno.land/std/path/mod.ts";
import {
  fetchComparison,
  fetchProductAnalysis,
  fetchRecentProducts,
  fetchSampleValuation,
  graylogConfigFromEnv,
} from "./core/graylog.ts";

const ROOT = fromFileUrl(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const kiosks = new Map<string, { lastSeen: number; disabled: boolean }>();

Deno.serve(async (req) => {
  const url = new URL(req.url);

  try {
    if (url.pathname === "/api/health") {
      const graylog = graylogConfigFromEnv();
      return Response.json({
        ok: true,
        graylogConfigured: Boolean(graylog),
        graylogStreamId: graylog?.streamId || null,
        graylogRangeSeconds: graylog?.rangeSeconds || null,
      });
    }

    if (url.pathname === "/api/heartbeat") {
      const id = req.headers.get("x-kiosk-id") || "unknown";
      const existing = kiosks.get(id);
      kiosks.set(id, { lastSeen: Date.now(), disabled: existing?.disabled || false });
      return Response.json({ ok: true, disabled: kiosks.get(id)?.disabled || false });
    }

    if (url.pathname === "/api/kiosks") {
      return Response.json([...kiosks.entries()].map(([id, kiosk]) => ({
        id,
        lastSeen: kiosk.lastSeen,
        online: !kiosk.disabled && Date.now() - kiosk.lastSeen < 15000,
        disabled: kiosk.disabled,
      })));
    }

    if (url.pathname.startsWith("/api/kiosks/") && url.pathname.endsWith("/disable")) {
      const id = url.pathname.split("/")[3];
      const existing = kiosks.get(id);
      kiosks.set(id, { lastSeen: existing?.lastSeen || 0, disabled: true });
      return Response.json({ ok: true, id, disabled: true });
    }

    if (url.pathname.startsWith("/api/kiosks/") && url.pathname.endsWith("/enable")) {
      const id = url.pathname.split("/")[3];
      const existing = kiosks.get(id);
      kiosks.set(id, { lastSeen: existing?.lastSeen || Date.now(), disabled: false });
      return Response.json({ ok: true, id, disabled: false });
    }

    if (url.pathname.startsWith("/api/product/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() || "");
      const product = await fetchProductAnalysis(id);
      if (!product) return jsonError("Product not found in Graylog", 404);
      return Response.json(product);
    }

    if (url.pathname === "/api/products") {
      return Response.json(await fetchRecentProducts(Number(url.searchParams.get("limit") || 100)));
    }

    if (url.pathname === "/api/comparison") {
      return Response.json(await fetchComparison());
    }

    if (url.pathname === "/api/sample-valuation") {
      return Response.json(await fetchSampleValuation());
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
});

async function staticFile(name: string, contentType: string): Promise<Response> {
  return new Response(await Deno.readTextFile(join(PUBLIC, name)), {
    headers: { "content-type": contentType },
  });
}

function jsonError(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, { status });
}
