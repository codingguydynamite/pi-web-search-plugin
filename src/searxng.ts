// Thin, defensive client for a SearXNG JSON API instance.
//
// SearXNG (https://github.com/searxng/searxng) is a self-hosted metasearch
// engine. This module only ever talks to a base URL that *you* configure
// (SEARXNG_BASE_URL or pi settings), so nothing here phones home anywhere
// else.
//
// Security notes:
//   - base URL is validated to http/https with a hostname.
//   - JSON responses are validated structurally before use; malformed input
//     degrades to "no results" instead of throwing.
//   - All fetches honor the caller's AbortSignal plus a per-request timeout.

export interface SearxngResult {
    title: string;
    url: string;
    snippet?: string;
    engine?: string;
    category?: string;
}

export interface SearxngSearchResponse {
    results: SearxngResult[];
    rawResults: number;
    query: string;
}

export class SearxngError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.name = "SearxngError";
        this.status = status;
    }
}

/** Validate and normalize a SearXNG base URL. */
export function normalizeBaseUrl(input: string): string {
    let base = (input || "").trim();
    if (!base) throw new SearxngError("SearXNG base URL is empty");
    if (!/^[a-z]+:\/\//i.test(base)) base = `http://${base}`;
    let url: URL;
    try {
        url = new URL(base);
    } catch {
        throw new SearxngError(`Invalid SearXNG base URL: ${input}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new SearxngError(`SearXNG base URL must be http or https, got ${url.protocol}`);
    }
    if (!url.hostname) throw new SearxngError(`SearXNG base URL has no hostname: ${input}`);
    return base.replace(/\/+$/, "");
}

function pickString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

function extractText(html: string | undefined): string | undefined {
    if (!html) return undefined;
    const text = html
        .replace(/<\s*(?:style|script)\b[^>]*>[\s\S]*?<\s*\/\s*(?:style|script)\s*>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > 0 ? text : undefined;
}

export interface FetchOptions {
    signal?: AbortSignal;
    /** Milliseconds. Default 20000. */
    timeoutMs?: number;
}

/**
 * Query SearXNG via its JSON API: GET {base}/search?q=...&format=json
 * Returns [] results for "weird but valid" responses instead of throwing.
 */
export async function searxngSearch(
    baseUrl: string,
    query: string,
    options: FetchOptions = {},
): Promise<SearxngSearchResponse> {
    const base = normalizeBaseUrl(baseUrl);
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 20000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal?.aborted) controller.abort();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
        response = await fetch(url.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
            redirect: "follow",
        });
    } catch (error: any) {
        if (controller.signal.aborted) {
            throw new SearxngError(
                options.signal?.aborted
                    ? "Request was aborted"
                    : `SearXNG request timed out after ${timeoutMs} ms`,
            );
        }
        throw new SearxngError(`Cannot reach SearXNG at ${base}: ${error?.message || error}`);
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
        // 403 from SearXNG usually means the JSON format is not enabled in
        // its settings.yml (search.formats must include json).
        const hint =
            response.status === 403
                ? " (is the JSON format enabled in SearXNG settings? search.formats: [html, json])"
                : "";
        throw new SearxngError(`SearXNG API error (${response.status})${hint}`, response.status);
    }

    const data: any = await response.json().catch(() => ({}));
    const rawResults = Array.isArray(data?.results) ? data.results : [];
    const results: SearxngResult[] = [];
    for (const item of rawResults) {
        if (!item || typeof item !== "object") continue;
        const urlValue = pickString(item.url);
        if (!urlValue) continue;
        let u: URL;
        try {
            u = new URL(urlValue);
        } catch {
            continue;
        }
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        const engine = Array.isArray(item.engines) ? pickString(item.engines[0]) : pickString(item.engine);
        results.push({
            title: pickString(item.title) || u.hostname,
            url: u.toString(),
            snippet: extractText(item.content),
            engine,
            category: pickString(item.category),
        });
    }
    return { results, rawResults: rawResults.length, query };
}
