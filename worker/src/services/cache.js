/**
 * Cache service - KV and Cache API operations
 * Per Constitution v1.1.0: Use env.DOMAIN for cache keys to avoid DNS lookups
 */

/**
 * Get cached link from KV
 * @param {Object} env - Environment bindings
 * @param {string} slug - Link slug
 * @returns {Promise<Object|null>} Cached link data or null
 */
export async function getCachedLink(env, slug) {
  const cached = await env.CACHE_KV.get(`L:${slug}`, {
    type: 'json',
    cacheTtl: 120, // 2 minutes edge cache
  });

  return cached;
}

/**
 * Set cached link in KV
 * @param {Object} env - Environment bindings
 * @param {string} slug - Link slug
 * @param {Object} data - Link data to cache
 */
export async function setCachedLink(env, slug, { target, status, expiresAt }) {
  const now = Math.floor(Date.now() / 1000);
  const value = JSON.stringify({ target, status, expiresAt });

  const options = {};
  if (expiresAt) {
    // Auto-remove at expiration
    options.expirationTtl = expiresAt - now;
  }

  await env.CACHE_KV.put(`L:${slug}`, value, options);
}

/**
 * How long a "not found" result is cached per PoP in the Cache API (seconds).
 *
 * Negative results are intentionally NOT stored in KV: KV writes are the
 * scarcest quota (1,000/day on the free plan) and scanners requesting random
 * paths would otherwise cost one KV write per miss.
 */
export const NEGATIVE_CACHE_TTL = 300; // 5 minutes

/**
 * Cache a 404 response in Cache API (negative cache)
 * Uses the same cache key as redirects, so a later cache.match() returns the 404
 * without touching KV or D1. Costs no KV operations.
 * @param {Cache} cache - Cache API instance
 * @param {Request} cacheKey - Cache key (built from env.DOMAIN)
 * @param {Response} response - 404 response to cache
 */
export async function cacheNotFoundResponse(cache, cacheKey, response) {
  const responseToCache = new Response(response.body, response);
  responseToCache.headers.set('Cache-Control', `public, max-age=${NEGATIVE_CACHE_TTL}`);
  await cache.put(cacheKey, responseToCache);
}

/**
 * Remove a slug's entry (redirect or cached 404) from this PoP's Cache API
 * CRITICAL: Use env.DOMAIN for cache keys to avoid DNS lookups
 * @param {Object} env - Environment bindings
 * @param {string} slug - Link slug
 * @returns {Promise<boolean>} Whether an entry was deleted
 */
export async function purgeCachedResponse(env, slug) {
  const cacheKey = new Request(`https://${env.DOMAIN}/${slug}`, { method: 'GET' });
  return caches.default.delete(cacheKey);
}

/**
 * Invalidate link cache (KV and Cache API)
 * CRITICAL: Use env.DOMAIN for cache keys to avoid DNS lookups
 * @param {Object} env - Environment bindings
 * @param {string} slug - Link slug
 */
export async function invalidateLink(env, slug) {
  // Delete from KV (negative results live only in Cache API, so only `L:` exists)
  await env.CACHE_KV.delete(`L:${slug}`);

  // Delete from Cache API (redirect or cached 404)
  await purgeCachedResponse(env, slug);
}

/**
 * Cache a redirect response in Cache API
 * CRITICAL: Use env.DOMAIN for cache keys to avoid DNS lookups
 * @param {Cache} cache - Cache API instance
 * @param {string} domain - Domain from env.DOMAIN
 * @param {string} slug - Link slug
 * @param {Response} response - Response to cache
 */
export async function cacheRedirectResponse(cache, domain, slug, response) {
  // Build cache key using env.DOMAIN hostname
  const cacheKey = new Request(`https://${domain}/${slug}`, { method: 'GET' });

  // Clone response and add Cache-Control header
  const responseToCache = new Response(response.body, response);
  responseToCache.headers.set('Cache-Control', 'public, max-age=300'); // 5 minutes

  await cache.put(cacheKey, responseToCache);
}
