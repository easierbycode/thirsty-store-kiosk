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

await writeFreshArtifact(join(repoRoot, "_fresh"), "../apps/web/main.ts");
await writeFreshArtifact(
  join(repoRoot, "apps", "web", "_fresh"),
  "../main.ts",
);

console.log("Created Fresh-compatible deployment artifacts:");
await logArtifact(join(repoRoot, "_fresh"));
await logArtifact(join(repoRoot, "apps", "web", "_fresh"));

async function writeFreshArtifact(
  artifactDir: string,
  importPath: string,
): Promise<void> {
  await Deno.mkdir(artifactDir, { recursive: true });
  await Deno.writeTextFile(
    join(artifactDir, "server.js"),
    `import { handleRequest } from "${importPath}";

export default {
  fetch: handleRequest,
};
`,
  );
  await Deno.writeTextFile(
    join(artifactDir, "compiled-entry.js"),
    `import fetcher from "./server.js";

Deno.serve(
  { port: Deno.env.get("PORT"), hostname: Deno.env.get("HOSTNAME") },
  fetcher.fetch,
);
`,
  );

  await Deno.mkdir(join(artifactDir, "client", ".vite"), { recursive: true });
  await Deno.writeTextFile(
    join(artifactDir, "client", ".vite", "manifest.json"),
    "{}\n",
  );
  await Deno.mkdir(join(artifactDir, "server", ".vite"), { recursive: true });
  await Deno.writeTextFile(
    join(artifactDir, "server", ".vite", "manifest.json"),
    "{}\n",
  );
}

async function logArtifact(artifactDir: string): Promise<void> {
  const files = [
    "server.js",
    "compiled-entry.js",
    "client/.vite/manifest.json",
    "server/.vite/manifest.json",
  ];

  for (const file of files) {
    const path = join(artifactDir, file);
    const stat = await Deno.stat(path);
    console.log(`- ${path} (${stat.size} bytes)`);
  }
}
