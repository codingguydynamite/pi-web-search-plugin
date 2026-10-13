import test from 'node:test';
import assert from 'node:assert/strict';
import { searxngSearch, normalizeBaseUrl, SearxngError } from '../src/searxng.ts';

test('normalizeBaseUrl accepts bare hosts and rejects bad schemes', () => {
  assert.equal(normalizeBaseUrl('192.168.1.69:8080'), 'http://192.168.1.69:8080');
  assert.equal(normalizeBaseUrl('http://x:8080/'), 'http://x:8080');
  assert.equal(normalizeBaseUrl('https://x.example:8080/a/'), 'https://x.example:8080/a');
  assert.throws(() => normalizeBaseUrl(''), SearxngError);
  assert.throws(() => normalizeBaseUrl('file:///tmp/x'), SearxngError);
  assert.throws(() => normalizeBaseUrl('http://'), SearxngError);
});

test('searxngSearch returns validated results and drops malformed entries', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'http://192.168.1.69:8080/search?q=react&format=json');
    assert.equal(init.headers.Accept, 'application/json');
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(
      JSON.stringify({
        query: 'react',
        results: [
          { title: 'React', url: 'https://react.dev', content: '<b>The</b> library for web &amp; native' },
          { title: 'No URL entry' },
          { title: 'Bad URL', url: 'not-a-url' },
          { title: 'Scheme attack', url: 'javascript:alert(1)' },
          null,
          'junk',
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  const result = await searxngSearch('http://192.168.1.69:8080', 'react');
  assert.equal(result.rawResults, 6);
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0], {
    title: 'React',
    url: 'https://react.dev/',
    snippet: 'The library for web & native',
    engine: undefined,
    category: undefined,
  });
});

test('searxngSearch maps the engines[] array to engine', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      JSON.stringify({
        results: [{ title: 'T', url: 'https://example.com', engines: ['google cse', 'bing'] }],
      }),
      { status: 200 },
    ),
  );
  const result = await searxngSearch('http://192.168.1.69:8080', 'q');
  assert.equal(result.results[0].engine, 'google cse');
});

test('searxngSearch surfaces 403 with the JSON-format hint', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('forbidden', { status: 403 }));
  await assert.rejects(
    searxngSearch('http://192.168.1.69:8080', 'q'),
    /SearXNG API error \(403\).*JSON format/i,
  );
});

test('searxngSearch times out when the server never answers', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  );
  await assert.rejects(searxngSearch('http://192.168.1.69:8080', 'q', { timeoutMs: 50 }), /timed out/i);
});

test('searxngSearch propagates caller abort', async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      controller.abort();
    }),
  );
  await assert.rejects(searxngSearch('http://192.168.1.69:8080', 'q', { signal: controller.signal }), /aborted/i);
});

test('searxngSearch reports unreachable hosts without leaking stack', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    searxngSearch('http://192.168.1.69:8080', 'q'),
    /Cannot reach SearXNG at http:\/\/192\.168\.1\.69:8080/,
  );
});

test('searxngSearch tolerates non-JSON bodies as zero results', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>not json</html>', { status: 200 }));
  const result = await searxngSearch('http://192.168.1.69:8080', 'q');
  assert.deepEqual(result, { results: [], rawResults: 0, query: 'q' });
});
