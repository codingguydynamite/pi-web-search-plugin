// Render SearXNG results and fetched pages into model-friendly text.

import type { SearxngResult } from "./searxng.ts";
import type { FetchedPage } from "./url_fetch.ts";

export function formatSearchResults(query: string, results: SearxngResult[]): string {
    if (results.length === 0) return `No SearXNG results for "${query}".`;
    const lines = results.map((result, index) => {
        const snippet = result.snippet ? `\n   ${result.snippet}` : "";
        const engine = result.engine ? `  [via ${result.engine}]` : "";
        return `${index + 1}. ${result.title}\n   ${result.url}${snippet}${engine}`;
    });
    return `Search results for "${query}" via SearXNG:\n\n${lines.join("\n")}`;
}

export function formatFetchedPages(pages: FetchedPage[]): string {
    const ok = pages.filter((page) => page.ok && page.text);
    const failed = pages.filter((page) => !page.ok || !page.text);

    let text = "";
    for (const page of ok) {
        text += `\n## ${page.title || page.url}\n${page.finalUrl || page.url}\n\n${page.text}\n`;
        if (page.truncated) text += `[content truncated]\n`;
    }
    if (failed.length > 0) {
        text += `\n## Unreadable or failed:\n`;
        for (const page of failed) {
            text += `- ${page.url}: ${page.error || `HTTP ${page.status ?? "error"}`}\n`;
        }
    }
    return text.trim() || "Nothing was fetched.";
}
