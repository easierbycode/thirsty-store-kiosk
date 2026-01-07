import { Webview } from "webview";

const w = new Webview(true, {
  width: 1280,
  height: 800,
  resizable: false
});

w.setTitle("Thirsty Admin");
w.setFullscreen(true);

w.navigate("file://" + Deno.cwd() + "/apps/admin/dist/index.html");
w.run();