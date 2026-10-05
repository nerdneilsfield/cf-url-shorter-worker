/**
 * Redirect handler - GET /:slug
 * Implements multi-tier caching: Cache API → KV → D1
 * Not-found results are cached in Cache API only (never in KV)
 * Per Constitution v1.1.0: Use env.DOMAIN for cache keys, target <50ms CPU time
 */

import { getLink } from '../services/links.js';
import { getCachedLink, setCachedLink, cacheNotFoundResponse } from '../services/cache.js';
import { recordVisit } from '../services/analytics.js';
import { isValidSlug } from '../models/link.js';

/**
 * Handle redirect requests
 * @param {Request} request - HTTP request
 * @param {Object} env - Environment bindings
 * @param {ExecutionContext} ctx - Execution context
 * @param {string} slug - Link slug from URL
 * @returns {Response} Redirect or 404 response
 */
export async function handleRedirect(request, env, ctx, slug) {
  // Reject slugs that can never exist (e.g. scanner paths like `alfa.php`, `.env`)
  // before touching Cache API, KV or D1
  if (!isValidSlug(slug)) {
    return create404Response();
  }

  const cache = caches.default;
  const now = Math.floor(Date.now() / 1000);

  // Build cache key using env.DOMAIN to avoid DNS lookups
  const cacheKey = new Request(`https://${env.DOMAIN}/${slug}`, { method: 'GET' });

  // Try Cache API first (fastest)
  let response = await cache.match(cacheKey);
  if (response) {
    // Cached negative result: skip KV/D1 and don't count it as a visit
    if (response.status === 404) {
      return response;
    }

    // Record analytics (non-blocking)
    recordVisit(env, ctx, slug, request);
    return response;
  }

  // Try KV cache
  const cached = await getCachedLink(env, slug);
  if (cached) {
    // Check if expired
    if (cached.expiresAt && cached.expiresAt <= now) {
      return create404Response();
    }

    // Build redirect response
    response = Response.redirect(cached.target, cached.status);

    // Cache in Cache API for future requests
    ctx.waitUntil(cacheResponse(cache, cacheKey, response.clone()));

    // Record analytics (non-blocking)
    recordVisit(env, ctx, slug, request);

    return response;
  }

  // KV miss - query D1
  const link = await getLink(env, slug);

  if (!link) {
    // Not found - negative cache in Cache API (no KV write)
    response = create404Response();
    ctx.waitUntil(cacheNotFoundResponse(cache, cacheKey, response.clone()));
    return response;
  }

  // Check if expired
  if (link.expiresAt && link.expiresAt <= now) {
    return create404Response();
  }

  // Cache in KV for future requests
  await setCachedLink(env, slug, {
    target: link.target,
    status: link.status,
    expiresAt: link.expiresAt,
  });

  // Build redirect response
  response = Response.redirect(link.target, link.status);

  // Cache in Cache API
  ctx.waitUntil(cacheResponse(cache, cacheKey, response.clone()));

  // Record analytics (non-blocking)
  recordVisit(env, ctx, slug, request);

  return response;
}

/**
 * Cache a response in Cache API
 * @param {Cache} cache - Cache instance
 * @param {Request} cacheKey - Cache key
 * @param {Response} response - Response to cache
 */
async function cacheResponse(cache, cacheKey, response) {
  const responseToCache = new Response(response.body, response);
  responseToCache.headers.set('Cache-Control', 'public, max-age=300'); // 5 minutes
  await cache.put(cacheKey, responseToCache);
}

/**
 * Create a 404 response
 * @returns {Response} 404 response
 */
function create404Response() {
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <title>Link Not Found</title>
  <meta charset="utf-8">
  <style>
    body { font-family: sans-serif; text-align: center; padding: 50px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>404 - Link Not Found</h1>
  <p>This short link does not exist or has expired.</p>
</body>
</html>`,
    {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}
