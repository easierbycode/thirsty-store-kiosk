import { startWebApp } from "../../web/main.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

const host = Deno.env.get("THIRSTY_HOST") || DEFAULT_HOST;
const port = numberFrom(Deno.env.get("THIRSTY_PORT"), 0);
const kioskId = Deno.env.get("THIRSTY_KIOSK_ID") ||
  `kiosk-${slug(Deno.hostname())}`;
const heartbeatIntervalMs = numberFrom(
  Deno.env.get("THIRSTY_HEARTBEAT_INTERVAL_MS"),
  DEFAULT_HEARTBEAT_INTERVAL_MS,
);
const openUi = Deno.env.get("THIRSTY_OPEN_UI") !== "0";

console.log("[thirsty] starting admin dashboard");

const server = startWebApp({
  hostname: host,
  port,
  onListen: () => {},
});
const serverAddr = server.addr;

if (serverAddr.transport !== "tcp") {
  throw new Error(`unsupported server transport: ${serverAddr.transport}`);
}

const dashboardUrl = `http://${
  hostForUrl(serverAddr.hostname)
}:${serverAddr.port}/`;
const heartbeatUrl = Deno.env.get("THIRSTY_HEARTBEAT_URL") ||
  new URL("/api/heartbeat", dashboardUrl).href;

console.log(`[thirsty] dashboard listening at ${dashboardUrl}`);
console.log(`[thirsty] kiosk id: ${kioskId}`);
console.log(`[thirsty] heartbeat target: ${heartbeatUrl}`);

if (openUi) {
  try {
    await openUrl(dashboardUrl);
    console.log("[thirsty] dashboard opened in the default browser");
  } catch (error) {
    console.error(`[thirsty] ${messageFrom(error)}`);
    console.log(`[thirsty] open this URL manually: ${dashboardUrl}`);
  }
} else {
  console.log("[thirsty] dashboard auto-open disabled by THIRSTY_OPEN_UI=0");
}

await sendHeartbeat();
const heartbeatTimer = setInterval(
  () => void sendHeartbeat(),
  heartbeatIntervalMs,
);

addShutdownListener("SIGINT");
addShutdownListener("SIGTERM");

async function sendHeartbeat(): Promise<void> {
  const started = Date.now();

  try {
    const response = await fetch(heartbeatUrl, {
      headers: { "x-kiosk-id": kioskId },
    });
    const body = await readJson(response);

    if (!response.ok) {
      throw new Error(`${response.status} ${JSON.stringify(body)}`);
    }

    const disabled = typeof body.disabled === "boolean"
      ? ` disabled=${body.disabled}`
      : "";
    console.log(
      `[heartbeat] ${kioskId} ok${disabled} ${Date.now() - started}ms`,
    );
  } catch (error) {
    console.error(`[heartbeat] ${kioskId} failed: ${messageFrom(error)}`);
  }
}

async function openUrl(url: string): Promise<void> {
  const command = browserOpenCommand(url);
  if (!command) {
    console.log(`[thirsty] open this URL manually: ${url}`);
    return;
  }

  const output = await command.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `failed to open dashboard: exit ${output.code}${
        stderr ? `: ${stderr}` : ""
      }`,
    );
  }
}

function browserOpenCommand(url: string): Deno.Command | null {
  if (Deno.build.os === "darwin") {
    return new Deno.Command("open", { args: [url] });
  }

  if (Deno.build.os === "windows") {
    return new Deno.Command("cmd", { args: ["/c", "start", "", url] });
  }

  if (Deno.build.os === "linux") {
    return new Deno.Command("xdg-open", { args: [url] });
  }

  return null;
}

function addShutdownListener(signal: Deno.Signal): void {
  try {
    Deno.addSignalListener(signal, () => {
      console.log(`[thirsty] received ${signal}; shutting down`);
      clearInterval(heartbeatTimer);
      void server.shutdown().finally(() => Deno.exit(0));
    });
  } catch {
    // Some signals are not supported on every compile target.
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data = await response.json();
    return data && typeof data === "object"
      ? data as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function hostForUrl(value: string): string {
  if (value === "0.0.0.0") return DEFAULT_HOST;
  if (value === "::") return "[::1]";
  if (value.includes(":") && !value.startsWith("[")) return `[${value}]`;
  return value;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-|-$/g,
    "",
  ) || "local";
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
