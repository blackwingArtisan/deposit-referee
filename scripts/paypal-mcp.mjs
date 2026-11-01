#!/usr/bin/env node
/**
 * npm run paypal:mcp — start PayPal's official MCP server (@paypal/mcp, stdio) against the
 * SANDBOX, using this app's credentials. For development tools (Claude Code, Claude Desktop)
 * to inspect sandbox data; the app itself does not depend on it.
 *
 *   claude mcp add paypal-sandbox -- npm --prefix "$PWD" run -s paypal:mcp
 *
 * The OAuth token it mints lasts several hours; restart the server when it expires.
 * Never prints credentials or the token.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PAYPAL_MCP_VERSION = "1.8.1";

function load(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
load(path.resolve(".env.local"));
for (const f of [process.env.ENV_SHARED_PATH, path.resolve("../../.env.shared"), path.resolve("../.env.shared")]) {
  if (f && fs.existsSync(f)) {
    load(f);
    break;
  }
}

if ((process.env.PAYPAL_MODE ?? "mock") !== "sandbox") {
  console.error("paypal:mcp needs PAYPAL_MODE=sandbox and sandbox credentials (there is no MCP server for mock mode).");
  process.exit(1);
}
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are missing.");
  process.exit(1);
}

const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
  method: "POST",
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
if (!res.ok) {
  console.error(`Sandbox OAuth failed (HTTP ${res.status}).`);
  process.exit(1);
}
const { access_token } = await res.json();

// stdio passthrough: the MCP client talks to @paypal/mcp directly.
const child = spawn("npx", ["-y", `@paypal/mcp@${PAYPAL_MCP_VERSION}`, "--tools=all"], {
  stdio: "inherit",
  env: { ...process.env, PAYPAL_ACCESS_TOKEN: access_token, PAYPAL_ENVIRONMENT: "SANDBOX" },
});
child.on("exit", (code) => process.exit(code ?? 0));
