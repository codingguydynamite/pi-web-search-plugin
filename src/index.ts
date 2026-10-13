// pi extension: local SearXNG web search + URL fetch.
//
// Tools:
//   web_search  - search the web through a self-hosted SearXNG instance.
//   url_context - fetch and summarize readable text of public URLs.
//
// Both tools work with ANY model (including local LLMs), because all search
// happens server-side in SearXNG; the model just reads the results.
//
// Security posture (mirrors pi-web-search conventions):
//   - no install hooks, no runtime dependencies beyond pi host packages;
//   - fetch only: the SearXNG base URL (user-controlled) and the public URLs
//     the user/model asks to fetch;
//   - every network call is bounded by AbortSignal + per-call timeout;
//   - provider/model data is never modified; no telemetry.

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { resolveSearxngConfig } from "./config.ts";
import { formatFetchedPages, formatSearchResults } from "./format.ts";
import { SearxngError, searxngSearch } from "./searxng.ts";
import { fetchUrl } from "./url_fetch.ts";

const MAX_RESULTS = 10;
const MAX_URLS = 5;

const WebSearchSchema = Type.Object({
    query: Type.String({ description: "The search query to run through SearXNG" }),
});
export type WebSearchInput = Static<typeof WebSearchSchema>;

const UrlContextSchema = Type.Object({
    query: Type.String({ description: "What to extract or summarize from the URLs" }),
    urls: Type.Array(Type.String(), {
        description: "Public URLs to fetch and read (up to 5)",
        minItems: 1,
        maxItems: MAX_URLS,
    }),
});
export type UrlContextInput = Static<typeof UrlContextSchema>;

function errorResult(message: string): AgentToolResult<any> {
    return {
        content: [{ type: "text", text: `Failed: ${message}` }],
        details: { error: true },
    };
}

function describeConfig(baseUrl: string): string {
    return `SearXNG at ${baseUrl} (override with SEARXNG_BASE_URL or searxngSearch.baseUrl in pi settings)`;
}

async function runWebSearch(
    params: WebSearchInput,
    signal: AbortSignal,
    onUpdate: ((update: any) => void) | undefined,
): Promise<AgentToolResult<any>> {
    const { baseUrl } = resolveSearxngConfig();
    onUpdate?.({
        content: [{ type: "text", text: `Searching for "${params.query}" via SearXNG (${baseUrl})...` }],
        details: {},
    });
    try {
        const response = await searxngSearch(baseUrl, params.query, { signal });
        const results = response.results.slice(0, MAX_RESULTS);
        return {
            content: [{ type: "text", text: formatSearchResults(params.query, results) }],
            details: {
                providerKind: "searxng",
                nativeSearchUsed: true,
                baseUrl,
                query: params.query,
                resultCount: response.rawResults,
                sources: results.map((result) => ({ title: result.title, url: result.url })),
                searchResults: results.map((result, index) => ({
                    title: result.title,
                    url: result.url,
                    citedText: result.snippet,
                    source: "searxng.search",
                    type: "search_result",
                    engine: result.engine,
                    rank: index + 1,
                })),
                grounded: results.length > 0,
            },
        };
    } catch (error: any) {
        const message =
            error instanceof SearxngError || error instanceof Error
                ? error.message
                : String(error);
        return errorResult(message);
    }
}

async function runUrlContext(
    params: UrlContextInput,
    signal: AbortSignal,
    onUpdate: ((update: any) => void) | undefined,
): Promise<AgentToolResult<any>> {
    const count = params.urls.length;
    onUpdate?.({
        content: [{ type: "text", text: `Fetching ${count} URL(s)...` }],
        details: {},
    });
    const pages = await Promise.all(params.urls.map((url) => fetchUrl(url, { signal })));
    const text = `URL contents for: ${params.query}\n\n${formatFetchedPages(pages)}`;
    const retrieved = pages.filter((page) => page.ok && page.text).map((page) => page.finalUrl || page.url);
    const failed = pages
        .filter((page) => !page.ok || !page.text)
        .map((page) => ({ url: page.url, status: page.error || `HTTP ${page.status}` }));
    return {
        content: [{ type: "text", text }],
        details: {
            providerKind: "searxng",
            grounded: retrieved.length > 0,
            retrieved,
            ...(failed.length > 0 ? { failed } : {}),
            sources: retrieved.map((url) => ({ title: "", url })),
        },
    };
}

export default function (pi: ExtensionAPI): void {
    pi.registerTool({
        name: "web_search",
        label: "Web Search (SearXNG)",
        description:
            "Search the web through the local SearXNG metasearch engine. Returns titles, URLs and snippets. " +
            "Works with any model, including local LLMs.",
        parameters: WebSearchSchema,
        execute: (id, params, signal = new AbortController().signal, onUpdate, _ctx) =>
            runWebSearch(params as WebSearchInput, signal, onUpdate),
        renderCall(args, theme) {
            const query = (args as any)?.query || "…";
            return new Text(`${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", query)}`, 0, 0);
        },
        renderResult(result: any, { expanded }: any, theme: any) {
            const output = (result.content || [])
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text)
                .join("\n");
            const isError = Boolean(result.details?.error);
            if (!expanded && !isError) return new Text("", 0, 0);
            return new Text(theme.fg(isError ? "error" : "toolOutput", output), 0, 0);
        },
    });

    pi.registerTool({
        name: "url_context",
        label: "URL Context",
        description:
            "Fetch up to 5 public URLs and return their readable text so the model can answer about them. " +
            "Supports web pages and documents.",
        parameters: UrlContextSchema,
        execute: (id, params, signal = new AbortController().signal, onUpdate, _ctx) =>
            runUrlContext(params as UrlContextInput, signal, onUpdate),
        renderCall(args, theme) {
            const count = (args as any)?.urls?.length ?? 0;
            return new Text(
                `${theme.fg("toolTitle", theme.bold("url_context"))} ${theme.fg("accent", `${count} URL${count === 1 ? "" : "s}"}`)}`,
                0,
                0,
            );
        },
        renderResult(result: any, { expanded }: any, theme: any) {
            const output = (result.content || [])
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text)
                .join("\n");
            const isError = Boolean(result.details?.error);
            if (!expanded && !isError) return new Text("", 0, 0);
            return new Text(theme.fg(isError ? "error" : "toolOutput", output), 0, 0);
        },
    });

    console.log(`[pi-searxng-search] SearXNG web search enabled (${describeConfig(resolveSearxngConfig().baseUrl)})`);
}
