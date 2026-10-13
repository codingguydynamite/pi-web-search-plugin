// Configuration for the extension.
//
// Precedence (highest first):
//   1. Process env:      SEARXNG_BASE_URL=http://192.168.1.69:8080
//   2. pi settings file: ~/.pi/agent/settings.json ->
//      { "searxngSearch": { "baseUrl": "http://192.168.1.69:8080" } }
//   3. Default:          http://192.168.1.69:8080
//
// The settings-file read is intentionally minimal: a single JSON parse of a
// local file managed by pi. It never writes anything.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SearxngConfig {
    baseUrl: string;
}

// Default points at the user's LAN SearXNG instance (docker container on
// 192.168.1.69, port 8080). Override with SEARXNG_BASE_URL or pi settings.
const DEFAULT_BASE_URL = "http://192.168.1.69:8080";

function readPiSettingsSearxng(): string | undefined {
    const candidates = [
        process.env.PI_CODING_AGENT_DIR
            ? join(process.env.PI_CODING_AGENT_DIR, "settings.json")
            : undefined,
        join(getAgentDir(), "settings.json"),
    ].filter((value): value is string => Boolean(value));

    for (const path of candidates) {
        let raw: string;
        try {
            raw = readFileSync(path, "utf8");
        } catch {
            continue;
        }
        try {
            const parsed: any = JSON.parse(raw);
            const value = parsed?.searxngSearch?.baseUrl;
            if (typeof value === "string" && value.trim()) return value.trim();
        } catch {
            continue;
        }
    }
    return undefined;
}

export function resolveSearxngConfig(): SearxngConfig {
    const env = process.env.SEARXNG_BASE_URL?.trim();
    if (env) return { baseUrl: env };
    const fromSettings = readPiSettingsSearxng();
    if (fromSettings) return { baseUrl: fromSettings };
    return { baseUrl: DEFAULT_BASE_URL };
}
