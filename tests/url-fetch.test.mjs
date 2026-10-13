import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUrl, extractReadableText, normalizeFetchUrl, FETCH_MAX_CHARS } from '../src/url_fetch.ts';

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>  Doc Title   </title>
  <style>.x { color: red }</style>
  <script>var evil = "donotshow";</script>
</head>
<body>
  <h1>Heading</h1>
  <p>First paragraph with &amp; entity.</p>
  <ul><li>item one</li><li>item two</li></ul>
  <script>document.write('hidden');</script>
  <p>Second paragraph.</p>
</body>
</html>`;

test('extractReadableText strips head/scripts/style and keeps text', () => {
  const { title, text } = extractReadableText(SAMPLE_HTML);
  assert.equal(title, 'Doc Title');
  assert.match(text, /Heading/);
  assert.match(text, /First paragraph with & entity\./);
  assert.match(text, /item one/);
  assert.match(text, /Second paragraph\./);
  assert.doesNotMatch(text, /donotshow/);
  assert.doesNotMatch(text, /document\.write/);
  assert.doesNotMatch(text, /color: red/);
});

test('normalizeFetchUrl rejects non-http schemes', () => {
  assert.throws(() => normalizeFetchUrl('file:///etc/passwd'));
  assert.throws(() => normalizeFetchUrl('ftp://example.com'));
  assert.throws(() => normalizeFetchUrl(''));
  assert.equal(normalizeFetchUrl('example.com/a').protocol, 'https:');
  assert.equal(normalizeFetchUrl('http://example.com/a').protocol, 'http:');
});

test('fetchUrl returns readable page with title and status', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://example.com/page');
    assert.match(init.headers['User-Agent'], /pi-searxng-search/);
    return new Response(SAMPLE_HTML, {
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/page',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
  const page = await fetchUrl('https://example.com/page');
  assert.equal(page.ok, true);
  assert.equal(page.status, 200);
  assert.equal(page.title, 'Doc Title');
  assert.match(page.text, /First paragraph/);
  assert.equal(page.truncated, false);
});

test('fetchUrl caps text at maxChars and marks truncated', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response('<html><body>' + 'word '.repeat(5000) + '</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  );
  const page = await fetchUrl('https://example.com/big');
  assert.equal(page.ok, true);
  assert.equal(page.truncated, true);
  assert.equal(page.text.length, FETCH_MAX_CHARS);
});

test('fetchUrl keeps ok=true but flags empty extraction', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response('<html><head><title>SPA</title></head><body><div id="root"></div></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  );
  const page = await fetchUrl('https://spa.example.com');
  assert.equal(page.ok, true);
  assert.equal(page.status, 200);
  assert.equal(page.text, '');
  assert.match(page.error, /No readable text extracted/i);
});

test('fetchUrl rejects binary content types', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response('binary', {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    }),
  );
  const page = await fetchUrl('https://example.com/file.zip');
  assert.equal(page.ok, false);
  assert.match(page.error, /Content type not readable/i);
});

test('fetchUrl reports HTTP errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }));
  const page = await fetchUrl('https://example.com/missing');
  assert.equal(page.ok, false);
  assert.equal(page.status, 404);
  assert.equal(page.error, 'HTTP 404');
});

test('fetchUrl reports network failures', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  const page = await fetchUrl('https://down.example.com');
  assert.equal(page.ok, false);
  assert.match(page.error, /Fetch failed/i);
});

test('fetchUrl honors caller abort', async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      controller.abort();
    }),
  );
  const page = await fetchUrl('https://example.com', { signal: controller.signal });
  assert.equal(page.ok, false);
  assert.equal(page.error, 'Request was aborted');
});

test('fetchUrl times out on slow responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('timeout')));
    }),
  );
  const page = await fetchUrl('https://slow.example.com', { timeoutMs: 50 });
  assert.equal(page.ok, false);
  assert.match(page.error, /Timed out/i);
});
