import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { getConfig } from "../src/config/env";
import { createStorage } from "../src/storage";
import { MARKER_FILE } from "../src/storage/local-ssd-adapter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (response: Response) => response.json() as Promise<any>;

let server: Server;
let base: string;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tmh-app-test-"));
  await writeFile(path.join(root, MARKER_FILE), "test");
  const config = getConfig({ MEDIA_STORAGE_ROOT: root, FRONTEND_ORIGIN: "http://localhost:3000", NODE_ENV: "test" });
  server = createApp(config, createStorage(config)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe("backend app", () => {
  it("GET /api/health reports server and storage state without leaking paths", async () => {
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { server: "up", storage: "up", firestore: "not_configured" } });
    expect(JSON.stringify(body)).not.toContain(root);
    expect(response.headers.get("x-powered-by")).toBeNull();
  });

  it("returns 503 when the storage marker disappears (drive unplugged)", async () => {
    await rm(path.join(root, MARKER_FILE));
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(503);
    expect((await json(response)).data.storage).toBe("down");
    await writeFile(path.join(root, MARKER_FILE), "test");
  });

  it("allows CORS only for the configured frontend origin", async () => {
    const allowed = await fetch(`${base}/api/health`, { headers: { Origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const blocked = await fetch(`${base}/api/health`, { headers: { Origin: "https://evil.example" } });
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers unknown routes and bad JSON with the standard error envelope", async () => {
    const missing = await fetch(`${base}/api/does-not-exist`);
    expect(missing.status).toBe(404);
    expect((await json(missing)).error.code).toBe("not_found");
    const badJson = await fetch(`${base}/api/health`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
    expect(badJson.status).toBe(400);
    expect((await json(badJson)).error.code).toBe("invalid_json");
  });

  it("rejects an unsafe CORS configuration", () => {
    expect(() => getConfig({ MEDIA_STORAGE_ROOT: root, FRONTEND_ORIGIN: "*" })).toThrow(/explicit origins/);
    expect(() => getConfig({})).toThrow(/MEDIA_STORAGE_ROOT/);
  });
});
