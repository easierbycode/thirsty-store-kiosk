import { join, fromFileUrl } from "https://deno.land/std/path/mod.ts";
const ROOT = fromFileUrl(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const kiosks = new Map<string, number>();

Deno.serve(async (req)=>{
 const url=new URL(req.url);
 if(url.pathname==="/api/heartbeat"){
  const id=req.headers.get("x-kiosk-id")||"unknown";
  kiosks.set(id,Date.now());
  return new Response("ok");
 }
 if(url.pathname==="/api/kiosks"){
  return Response.json([...kiosks.entries()].map(([id,lastSeen])=>({
    id,lastSeen,online:Date.now()-lastSeen<15000
  })));
 }
 if(url.pathname.endsWith("/disable")){
  const id=url.pathname.split("/")[3];
  kiosks.set(id,0);
  return new Response("disabled");
 }
 if(url.pathname==="/"){
  return new Response(await Deno.readTextFile(join(PUBLIC,"index.html")),{headers:{"content-type":"text/html"}});
 }
 if(url.pathname==="/ui.js"){
  return new Response(await Deno.readTextFile(join(PUBLIC,"ui.js")),{headers:{"content-type":"text/javascript"}});
 }
 return new Response("Not Found",{status:404});
});
