import { dirname, fromFileUrl, join } from "https://deno.land/std/path/mod.ts";

const root = dirname(fromFileUrl(import.meta.url));
const repoRoot = dirname(root);
const buildCwd = Deno.cwd();

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
await writeFreshEntrypoint(
  join(buildCwd, "_fresh", "server.js"),
  freshImportPathForCwd(buildCwd),
);

console.log(`Created Fresh compatibility entrypoints from cwd ${buildCwd}:`);
await logFreshEntrypoint(join(repoRoot, "_fresh", "server.js"));
await logFreshEntrypoint(join(repoRoot, "apps", "web", "_fresh", "server.js"));
await logFreshEntrypoint(join(buildCwd, "_fresh", "server.js"));

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

function freshImportPathForCwd(cwd: string): string {
  return cwd.endsWith("/apps/web") ? "../main.ts" : "../apps/web/main.ts";
}

async function logFreshEntrypoint(path: string): Promise<void> {
  const stat = await Deno.stat(path);
  console.log(`- ${path} (${stat.size} bytes)`);
}
