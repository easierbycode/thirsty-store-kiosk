import { serveFile } from "https://deno.land/std/http/file_server.ts";

Deno.serve((req) => {
  const url = new URL(req.url);
  if (url.pathname === "/") return serveFile(req, "./public/index.html");
  return new Response("Not Found", { status: 404 });
});
