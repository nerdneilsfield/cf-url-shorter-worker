/**
 * Link validation model
 * Validates link data against data-model.md specifications
 */

const SLUG_REGEX = /^[a-zA-Z0-9_-]+$/;
const MIN_SLUG_LENGTH = 1;
const MAX_SLUG_LENGTH = 32;
const MAX_TARGET_LENGTH = 2048;
const ALLOWED_STATUSES = [301, 302, 307, 308];

/**
 * Check whether a string can be a valid slug (same rules as validateLink)
 * Used on the redirect hot path to reject junk paths (e.g. `wp-login.php`, `.env`)
 * before any Cache API / KV / D1 access.
 * @param {string} slug - Candidate slug
 * @returns {boolean} True if the slug could exist
 */
export function isValidSlug(slug) {
  return (
    typeof slug === 'string' &&
    slug.length >= MIN_SLUG_LENGTH &&
    slug.length <= MAX_SLUG_LENGTH &&
    SLUG_REGEX.test(slug)
  );
}

/**
 * Validate a link object
 * @param {Object} data - Link data to validate
 * @param {string} data.slug - Short URL alias
 * @param {string} data.target - Destination URL
 * @param {number} data.status - HTTP redirect status
 * @param {number|null} data.expiresAt - Unix timestamp for expiration
 * @returns {string[]|null} Array of error messages or null if valid
 */
export function validateLink(data) {
  const errors = [];

  // Validate slug
  if (!data.slug || typeof data.slug !== 'string') {
    errors.push('Slug is required');
  } else if (data.slug.length < MIN_SLUG_LENGTH || data.slug.length > MAX_SLUG_LENGTH) {
    errors.push(`Slug must be between ${MIN_SLUG_LENGTH} and ${MAX_SLUG_LENGTH} characters`);
  } else if (!SLUG_REGEX.test(data.slug)) {
    errors.push('Slug can only contain letters, numbers, hyphens, and underscores');
  }

  // Validate target URL
  if (!data.target || typeof data.target !== 'string') {
    errors.push('Target URL is required');
  } else if (data.target.length > MAX_TARGET_LENGTH) {
    errors.push(`Target URL must be ${MAX_TARGET_LENGTH} characters or less`);
  } else {
    try {
      const url = new URL(data.target);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('Target URL must use http:// or https:// protocol');
      }
    } catch (e) {
      errors.push('Invalid URL format');
    }
  }

  // Validate status code
  if (data.status !== undefined && !ALLOWED_STATUSES.includes(data.status)) {
    errors.push(`Status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }

  // Validate expiration timestamp
  if (data.expiresAt !== null && data.expiresAt !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (typeof data.expiresAt !== 'number' || data.expiresAt <= now) {
      errors.push('Expiration time must be a future Unix timestamp');
    }
  }

  return errors.length > 0 ? errors : null;
}
