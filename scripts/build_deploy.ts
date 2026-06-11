import { dirname, fromFileUrl, join } from "https://deno.land/std/path/mod.ts";

const root = dirname(fromFileUrl(import.meta.url));
const repoRoot = dirname(root);

const check = new Deno.Command(Deno.execPath(), {
  args: ["check", "apps/web/main.ts"],
  cwd: repoRoot,
  stdout: "inherit",
  stderr: "inherit",
});
const result = await check.output();
if (!result.success) Deno.exit(result.code);

await writeFreshEntrypoint(
  join(repoRoot, "_fresh", "server.js"),
  "../apps/web/main.ts",
);
await writeFreshEntrypoint(
  join(repoRoot, "apps", "web", "_fresh", "server.js"),
  "../main.ts",
);

console.log("Created Fresh compatibility entrypoints.");

async function writeFreshEntrypoint(
  path: string,
  importPath: string,
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(
    path,
    `import { startWebApp } from "${importPath}";

startWebApp();
`,
  );
}
