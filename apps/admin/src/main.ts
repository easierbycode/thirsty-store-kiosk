import { Webview } from "webview";

const w=new Webview(true,{
  title:"Thirsty Admin",
  fullscreen:true,
  frameless:true,
  resizable:false
});

w.bind("heartbeat",()=>{
  return { ok:true, ts: Date.now() };
});

w.navigate("file://"+Deno.cwd()+"/apps/admin/dist/index.html");
w.run();
