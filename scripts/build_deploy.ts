const check = new Deno.Command(Deno.execPath(), {
  args: ["check", "apps/web/main.ts"],
  stdout: "inherit",
  stderr: "inherit",
});
const result = await check.output();
if (!result.success) Deno.exit(result.code);

await Deno.mkdir("_fresh", { recursive: true });
await Deno.writeTextFile(
  "_fresh/server.js",
  `import { startWebApp } from "../apps/web/main.ts";

startWebApp();
`,
);

console.log("Created _fresh/server.js compatibility entrypoint.");
