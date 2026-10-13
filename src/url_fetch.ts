// Fetch a public URL and return readable text for the model.
//
// - Strips <head>, <style>, <script> and markup; keeps visible text.
// - Caps output at maxChars (default 8000) to protect the model context.
// - Only http/https URLs are accepted.

export const FETCH_MAX_CHARS = 8000;

export interface FetchedPage {
    url: string;
    ok: boolean;
    finalUrl?: string;
    status?: number;
    title?: string;
    text?: string;
    truncated?: boolean;
    error?: string;
}

export function normalizeFetchUrl(input: string): URL {
    let value = (input || "").trim();
    if (!value) throw new Error("URL is empty");
    if (!/^[a-z]+:\/\//i.test(value)) value = `https://${value}`;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`Invalid URL: ${input}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Only http/https URLs are supported, got ${url.protocol}`);
    }
    return url;
}

export function extractReadableText(html: string): { title?: string; text: string } {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || undefined;

    let body = html;
    const bodyMatch = body.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) body = bodyMatch[1];

    const text = body
        .replace(/<\s*head\b[\s\S]*?<\s*\/\s*head\s*>/gi, " ")
        .replace(/<\s*(?:style|script|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\s*\/\s*(?:style|script|noscript|template|svg|iframe)\s*>/gi, " ")
        .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/[ \t]+/g, " ")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n")
        .trim();

    return { title, text };
}

export interface FetchUrlOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxChars?: number;
    userAgent?: string;
}

export async function fetchUrl(url: string, options: FetchUrlOptions = {}): Promise<FetchedPage> {
    let target: URL;
    try {
        target = normalizeFetchUrl(url);
    } catch (error: any) {
        return { url, ok: false, error: error.message };
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 20000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal?.aborted) controller.abort();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
        response = await fetch(target.toString(), {
            method: "GET",
            headers: {
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "User-Agent":
                    options.userAgent || "pi-searxng-search/1.0 (pi extension; contact: local)",
            },
            signal: controller.signal,
            redirect: "follow",
        });
    } catch (error: any) {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        if (controller.signal.aborted) {
            return {
                url,
                ok: false,
                error: options.signal?.aborted ? "Request was aborted" : `Timed out after ${timeoutMs} ms`,
            };
        }
        return { url, ok: false, error: `Fetch failed: ${error?.message || error}` };
    }
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);

    if (!response.ok) {
        return { url, ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/(html|xml)|application\/(xhtml|xml|json)/i.test(contentType)) {
        return {
            url,
            ok: false,
            status: response.status,
            finalUrl: response.url,
            error: `Content type not readable as text: ${contentType}`,
        };
    }

    let html: string;
    try {
        html = await response.text();
    } catch (error: any) {
        return { url, ok: false, status: response.status, error: `Body read failed: ${error?.message || error}` };
    }

    const { title, text } = extractReadableText(html);
    const maxChars = options.maxChars ?? FETCH_MAX_CHARS;
    const truncated = text.length > maxChars;
    return {
        url,
        ok: true,
        finalUrl: response.url || target.toString(),
        status: response.status,
        title,
        text: truncated ? text.slice(0, maxChars) : text,
        truncated,
        // Fetch succeeded but nothing readable came out (typical for
        // JavaScript-rendered SPAs). Distinguished from network/HTTP errors.
        ...(text.length === 0 ? { error: "No readable text extracted (page may be JavaScript-rendered)" } : {}),
    };
}
