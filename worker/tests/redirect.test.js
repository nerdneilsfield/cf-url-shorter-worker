/**
 * Redirect handler tests - negative caching and slug validation
 * Uses in-memory mocks for Cache API, KV and D1 (no Cloudflare account needed)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleRedirect } from '../src/handlers/redirect.js';
import { handleCreateLink } from '../src/handlers/admin.js';
import { invalidateLink, NEGATIVE_CACHE_TTL } from '../src/services/cache.js';

const DOMAIN = 'short.example.com';
const TOKEN = 'test-token';

function createEnv(links = {}) {
  const kv = new Map();
  const env = {
    DOMAIN,
    URL_SHORTER_ADMIN_TOKEN: TOKEN,
    CACHE_KV: {
      get: vi.fn(async (key) => (kv.has(key) ? JSON.parse(kv.get(key)) : null)),
      put: vi.fn(async (key, value) => {
        kv.set(key, value);
      }),
      delete: vi.fn(async (key) => {
        kv.delete(key);
      }),
    },
    ANALYTICS: { writeDataPoint: vi.fn() },
    DB: {
      prepare: vi.fn((sql) => ({
        bind: (...args) => ({
          first: vi.fn(async () => links[args[0]] || null),
          run: vi.fn(async () => {
            if (sql.startsWith('INSERT')) {
              const [slug, target, status, expiresAt, , createdAt] = args;
              links[slug] = {
                id: 1,
                slug,
                target,
                status,
                expires_at: expiresAt,
                visit_count: 0,
                created_at: createdAt,
                updated_at: createdAt,
              };
              return { success: true, meta: { last_row_id: 1, changes: 1 } };
            }
            return { success: true, meta: { changes: 1 } };
          }),
          all: vi.fn(async () => ({ results: [] })),
        }),
      })),
    },
  };
  return env;
}

function createCtx() {
  const pending = [];
  return {
    waitUntil: (promise) => pending.push(promise),
    flush: () => Promise.all(pending.splice(0)),
  };
}

function installCacheMock() {
  const store = new Map();
  const cache = {
    match: vi.fn(async (req) => store.get(req.url)?.clone()),
    put: vi.fn(async (req, res) => {
      store.set(req.url, res.clone());
    }),
    delete: vi.fn(async (req) => store.delete(req.url)),
  };
  globalThis.caches = { default: cache };
  return { cache, store };
}

const request = (slug) => new Request(`https://${DOMAIN}/${slug}`);

describe('handleRedirect', () => {
  let cache;

  beforeEach(() => {
    ({ cache } = installCacheMock());
  });

  it('returns 404 for invalid slugs without touching Cache API, KV or D1', async () => {
    const env = createEnv();
    const ctx = createCtx();

    for (const slug of ['alfa.php', '.env', 'favicon.ico', 'a'.repeat(33)]) {
      const res = await handleRedirect(request(slug), env, ctx, slug);
      expect(res.status).toBe(404);
    }
    await ctx.flush();

    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(env.CACHE_KV.get).not.toHaveBeenCalled();
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it('caches not-found results in Cache API and never writes to KV', async () => {
    const env = createEnv();
    const ctx = createCtx();

    const first = await handleRedirect(request('missing'), env, ctx, 'missing');
    await ctx.flush();

    expect(first.status).toBe(404);
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
    expect(cache.put).toHaveBeenCalledTimes(1);
    const [cacheKey, cached] = cache.put.mock.calls[0];
    expect(cacheKey.url).toBe(`https://${DOMAIN}/missing`);
    expect(cached.status).toBe(404);
    expect(cached.headers.get('Cache-Control')).toBe(`public, max-age=${NEGATIVE_CACHE_TTL}`);

    // Second request is answered from Cache API: no KV/D1 access, no visit recorded
    env.CACHE_KV.get.mockClear();
    env.DB.prepare.mockClear();
    const second = await handleRedirect(request('missing'), env, ctx, 'missing');
    await ctx.flush();

    expect(second.status).toBe(404);
    expect(env.CACHE_KV.get).not.toHaveBeenCalled();
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(env.ANALYTICS.writeDataPoint).not.toHaveBeenCalled();
  });

  it('still redirects existing links and caches them in KV and Cache API', async () => {
    const env = createEnv({
      docs: {
        id: 1,
        slug: 'docs',
        target: 'https://example.com/docs',
        status: 302,
        expires_at: null,
        visit_count: 0,
        created_at: 0,
        updated_at: 0,
      },
    });
    const ctx = createCtx();

    const res = await handleRedirect(request('docs'), env, ctx, 'docs');
    await ctx.flush();

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/docs');
    expect(env.CACHE_KV.put).toHaveBeenCalledWith('L:docs', expect.any(String), {});
    expect(env.CACHE_KV.put).toHaveBeenCalledTimes(1);
    expect(env.ANALYTICS.writeDataPoint).toHaveBeenCalledTimes(1);

    // Served from Cache API on the next request, visit still recorded
    const again = await handleRedirect(request('docs'), env, ctx, 'docs');
    await ctx.flush();
    expect(again.status).toBe(302);
    expect(env.ANALYTICS.writeDataPoint).toHaveBeenCalledTimes(2);
  });
});

describe('cache invalidation', () => {
  beforeEach(() => {
    installCacheMock();
  });

  it('invalidateLink only deletes the L: key from KV and purges Cache API', async () => {
    const env = createEnv();
    await invalidateLink(env, 'docs');

    expect(env.CACHE_KV.delete).toHaveBeenCalledTimes(1);
    expect(env.CACHE_KV.delete).toHaveBeenCalledWith('L:docs');
    expect(caches.default.delete).toHaveBeenCalledTimes(1);
  });

  it('creating a link purges a cached 404 for that slug', async () => {
    const links = {};
    const env = createEnv(links);
    const ctx = createCtx();

    const miss = await handleRedirect(request('new-link'), env, ctx, 'new-link');
    await ctx.flush();
    expect(miss.status).toBe(404);

    const createReq = new Request(`https://${DOMAIN}/api/admin/links`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-link', target: 'https://example.com/new' }),
    });
    const created = await handleCreateLink(createReq, env, ctx);
    await ctx.flush();
    expect(created.status).toBe(201);

    const hit = await handleRedirect(request('new-link'), env, ctx, 'new-link');
    await ctx.flush();
    expect(hit.status).toBe(302);
    expect(hit.headers.get('Location')).toBe('https://example.com/new');
  });
});
