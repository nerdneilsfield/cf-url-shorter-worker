/**
 * Admin API handlers
 * All handlers require HTTP Basic Auth
 */

import { validateLink } from '../models/link.js';
import { generateSlug } from '../utils/slug.js';
import { createLink, getLink, updateLink, deleteLink, listLinks } from '../services/links.js';
import { setCachedLink, invalidateLink, purgeCachedResponse } from '../services/cache.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * POST /api/admin/links - Create a new link
 */
export async function handleCreateLink(request, env, ctx) {
  // Require auth
  const authError = requireAuth(request, env);
  if (authError) return authError;

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // Generate slug if not provided
  const slug = body.slug || generateSlug(8);
  const target = body.target;
  const status = body.status || 302;
  const expiresAt = body.expiresAt || null;

  // Validate link data
  const errors = validateLink({ slug, target, status, expiresAt });
  if (errors) {
    return jsonResponse({ error: 'Validation failed', errors }, 400);
  }

  // Check if slug already exists
  const existing = await getLink(env, slug);
  if (existing) {
    return jsonResponse({ error: 'Slug already exists' }, 409);
  }

  // Create link in D1
  try {
    const link = await createLink(env, { slug, target, status, expiresAt });

    // Cache in KV
    await setCachedLink(env, slug, { target, status, expiresAt });

    // Drop a cached 404 for this slug in this PoP (best effort; other PoPs
    // expire it within NEGATIVE_CACHE_TTL seconds)
    ctx.waitUntil(purgeCachedResponse(env, slug).catch(() => {}));

    return jsonResponse(link, 201);
  } catch (error) {
    console.error('Failed to create link:', error);
    return jsonResponse({ error: 'Failed to create link' }, 500);
  }
}

/**
 * GET /api/admin/check-slug/:slug - Check if slug is available
 */
export async function handleCheckSlug(request, env, ctx, slug) {
  // Require auth
  const authError = requireAuth(request, env);
  if (authError) return authError;

  // Reserved paths
  const reserved = ['api', 'admin', 'health', 'favicon.ico', 'robots.txt', 'sitemap.xml'];
  if (reserved.includes(slug.toLowerCase())) {
    return jsonResponse({ available: false, reason: 'Reserved system path' });
  }

  // Check if slug exists
  try {
    const existing = await getLink(env, slug);
    if (existing) {
      return jsonResponse({ available: false, reason: 'Slug already exists' });
    }
    return jsonResponse({ available: true });
  } catch (error) {
    return jsonResponse({ available: true }); // If not found, it's available
  }
}

/**
 * GET /api/admin/links - List all links
 */
export async function handleListLinks(request, env, ctx) {
  // Require auth
  const authError = requireAuth(request, env);
  if (authError) return authError;

  // Parse limit parameter
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  try {
    const links = await listLinks(env, limit);
    const total = links.length;

    return jsonResponse({ links, total }, 200);
  } catch (error) {
    console.error('Failed to list links:', error);
    return jsonResponse({ error: 'Failed to list links' }, 500);
  }
}

/**
 * GET /api/admin/links/:slug - Get link details
 */
export async function handleGetLink(request, env, ctx, slug) {
  // Require auth
  const authError = requireAuth(request, env);
  if (authError) return authError;

  try {
    const link = await getLink(env, slug);

    if (!link) {
      return jsonResponse({ error: 'Link not found' }, 404);
    }

    // Add stats (placeholder - WAE integration would go here)
    const linkWithStats = {
      ...link,
      stats: {
        totalVisits: link.visitCount,
        last24h: 0, // Placeholder
        byCountry: [], // Placeholder
        byReferrer: [], // Placeholder
      },
    };

    return jsonResponse(linkWithStats, 200);
  } catch (error) {
    console.error('Failed to get link:', error);
    return jsonResponse({ error: 'Failed to get link' }, 500);
  }
}

/**
 * PATCH /api/admin/links/:slug - Update link
 */
export async function handleUpdateLink(request, env, ctx, slug) {
  // Require auth
  const authError = requireAuth(request, env);
  if (authError) return authError;

  // Check if link exists
  const existing = await getLink(env, slug);
  if (!existing) {
    return jsonResponse({ error: 'Link not found' }, 404);
  }

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // Validate updates
  const updates = {};
  if (body.target !== undefined) {
    updates.target = body.target;
  }
  if (body.status !== undefined) {
    updates.status = body.status;
  }
  if (body.expiresAt !== undefined) {
    updates.expiresAt = body.expiresAt;
  }

  // Validate updated link
  const toValidate = { ...existing, ...updates };
  const errors = validateLink(toValidate);
  if (errors) {
    return jsonResponse({ error: 'Validation failed', errors }, 400);
  }

  try {
    // Update in D1
    const link = await updateLink(env, slug, updates);

    // Invalidate cache
    await invalidateLink(env, slug);

    // Re-cache with new data
    await setCachedLink(env, slug, {
      target: link.target,
      status: link.status,
      expiresAt: link.expiresAt,
    });

    return jsonResponse(link, 200);
  } catch (error) {
    console.error('Failed to update link:', error);
    return jsonResponse({ error: 'Failed to update link' }, 500);
  }
}

/**
 * DELETE /api/admin/links/:slug - Delete link
 */
export async function handleDeleteLink(request, env, ctx, slug) {
  // Require auth
  const authError = requireAuth(request, env);
  if (authError) return authError;

  // Check if link exists
  const existing = await getLink(env, slug);
  if (!existing) {
    return jsonResponse({ error: 'Link not found' }, 404);
  }

  try {
    // Delete from D1
    await deleteLink(env, slug);

    // Invalidate cache
    await invalidateLink(env, slug);

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete link:', error);
    return jsonResponse({ error: 'Failed to delete link' }, 500);
  }
}

/**
 * GET /api/admin/links/:slug/stats - Get link statistics
 */
export async function handleGetStats(request, env, ctx, slug) {
  // Require auth
  const authError = requireAuth(request, env);
  if (authError) return authError;

  // Check if link exists
  const link = await getLink(env, slug);
  if (!link) {
    return jsonResponse({ error: 'Link not found' }, 404);
  }

  // Parse period parameter
  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '24h';

  // Placeholder stats (WAE SQL API integration would go here)
  const stats = {
    slug,
    period,
    totalVisits: link.visitCount,
    byCountry: [],
    byReferrer: [],
  };

  return jsonResponse(stats, 200);
}

/**
 * Helper: Create JSON response
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
