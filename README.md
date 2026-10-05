# URL Shortener Service

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-3.0-F38020)](https://developers.cloudflare.com/workers/wrangler/)

A fast, edge-compute URL shortener built with Cloudflare Workers, D1 (SQLite), KV cache, and Workers Analytics Engine.

[English](./README.md) | [中文文档](./README_zh.md)

📖 **Quick Links:**

- [English Setup Guide](./SETUP.md)
- [中文设置指南](./SETUP_zh.md)

## Screenshot

![Admin Dashboard](./images/UI.png)

## Features

- ⚡ **Fast redirects**: <100ms p99 latency with multi-tier caching
- 🌍 **Edge compute**: Global deployment on 300+ Cloudflare data centers
- 📊 **Analytics**: Visit tracking with country and referrer data
- 🔐 **Secure admin**: Token-based authentication for management operations
- 📱 **Mobile-friendly UI**: Responsive admin interface (≥320px screens)
- ⏰ **Auto-cleanup**: Daily cron job removes expired links
- 🎯 **Custom slugs**: User-defined aliases or auto-generated
- 🔄 **Multiple redirect types**: 301, 302, 307, 308 support

## Architecture

**Edge-first with multi-tier caching:**

- **D1 (SQLite)**: Source of truth for link data
- **Workers KV**: Global cache with 5-30s staleness tolerance
- **Cache API**: Per-PoP response caching for sub-10ms redirects; also caches 404s (negative cache) so unknown slugs never cost a KV write
- **Workers Analytics Engine**: Non-blocking visit event collection

## Quick Start

See [SETUP.md](./SETUP.md) for detailed setup instructions.

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- Node.js 18+ and npm
- Custom domain added to Cloudflare

### Installation

```bash
# Clone repository
git clone <your-repo-url>
cd cf-url-shorter-works

# Install dependencies
npm install

# Copy configuration templates
cp wrangler.example.toml wrangler.toml
cp .dev.vars.example .dev.vars

# Edit wrangler.toml and .dev.vars with your configuration
```

### Deploy

```bash
# Create Cloudflare resources
wrangler d1 create URL_SHORTENER_DB
wrangler kv namespace create CACHE_KV

# Apply database migration
wrangler d1 migrations apply URL_SHORTENER_DB

# Set production secret
wrangler secret put URL_SHORTER_ADMIN_TOKEN

# Deploy to production
npm run deploy
```

See [SETUP.md](./SETUP.md) for complete step-by-step instructions.

## Usage

### Create Short Link

**Via Admin UI:**

1. Visit `https://YOUR_DOMAIN/admin`
2. Enter your API token
3. Fill out the "Create Short Link" form

**Via API:**

```bash
curl -X POST https://YOUR_DOMAIN/api/admin/links \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target": "https://example.com/long/url",
    "slug": "my-link",
    "status": 302
  }'
```

### Access Short Link

```bash
curl -I https://YOUR_DOMAIN/my-link
# HTTP/1.1 302 Found
# Location: https://example.com/long/url
```

## API Reference

### Admin Endpoints

All admin endpoints require Bearer token authentication.

- `POST /api/admin/links` - Create a link
- `GET /api/admin/links` - List all links
- `GET /api/admin/links/:slug` - Get link details
- `PATCH /api/admin/links/:slug` - Update a link
- `DELETE /api/admin/links/:slug` - Delete a link
- `GET /api/admin/links/:slug/stats` - Get link statistics

### Public Endpoints

- `GET /:slug` - Redirect to target URL
- `GET /health` - Health check

Full API specification: [admin-api.yaml](./specs/001-cloudflare-workers-js/contracts/admin-api.yaml)

## Development

```bash
# Run locally with D1 local database
npm run dev

# Test cron triggers
npm run test:scheduled

# View live logs
wrangler tail

# Check D1 query performance
wrangler d1 insights URL_SHORTENER_DB

# Check bundle size before deploy
wrangler deploy --dry-run
```

## Configuration Files

This project uses example configuration files that you must copy and customize:

| Template File | Your Config File | Purpose | Commit to Git? |
|--------------|------------------|---------|----------------|
| `wrangler.example.toml` | `wrangler.toml` | Cloudflare Workers configuration | ❌ No |
| `.dev.vars.example` | `.dev.vars` | Local development secrets | ❌ No |

**Setup:**

```bash
cp wrangler.example.toml wrangler.toml
cp .dev.vars.example .dev.vars
# Edit both files with your values
```

⚠️ **Security**: `wrangler.toml` and `.dev.vars` are in `.gitignore` and should NEVER be committed.

## Performance

- **Redirect latency**: <100ms at p99 (with KV cache hit)
- **CPU time**: <50ms per request
- **Bundle size**: <1MB
- **Cache hit rate**: >90% for active links

## Project Structure

```
├── worker/
│   ├── src/
│   │   ├── index.js          # Main worker entry point
│   │   ├── handlers/          # Request handlers
│   │   ├── services/          # Business logic
│   │   ├── middleware/        # Auth, routing
│   │   ├── models/            # Data validation
│   │   └── utils/             # Helpers
│   └── tests/                 # Test suites
├── admin/                     # Static admin UI
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── migrations/                # D1 schema migrations
├── wrangler.example.toml      # Workers config template
├── .dev.vars.example          # Local secrets template
└── package.json
```

## Security

- **Authentication**: Bearer token authentication for admin endpoints
- **Input validation**: URL format, slug pattern, length limits enforced
- **SQL injection prevention**: Parameterized queries only (prepare/bind pattern)
- **No PII collection**: Analytics track aggregate data only
- **Secrets management**: Credentials stored as Wrangler Secrets (encrypted at rest)
- **Scanner traffic**: Invalid slugs (e.g. `wp-login.php`, `.env`) are rejected before any cache/KV/D1 access. To stop such requests before they even invoke the Worker, you can add a WAF custom rule (action: Block) on your zone, for example:

  ```
  (http.host eq "YOUR_DOMAIN" and (http.user_agent eq "" or http.request.uri.path contains ".php" or http.request.uri.path contains ".env"))
  ```

## Constitution Compliance

This project follows strict architectural principles defined in [Constitution v1.1.0](./.specify/memory/constitution.md):

- ✅ **Test-First Development** - TDD approach with tests before implementation
- ✅ **Platform-Native Patterns** - Direct Cloudflare APIs, no ORMs or abstractions
- ✅ **Simplicity & YAGNI** - Minimal dependencies, vanilla JS admin UI
- ✅ **Performance & Observability** - <50ms CPU time, wrangler monitoring tools
- ✅ **Open-Source Friendly** - Configurable domain, no hardcoded credentials

## Documentation

- [Setup Guide](./SETUP.md) - Step-by-step installation
- [Configuration Guide](./CONFIGURATION.md) - Detailed configuration reference
- [Feature Specification](./specs/001-cloudflare-workers-js/spec.md)
- [Implementation Plan](./specs/001-cloudflare-workers-js/plan.md)
- [Data Model](./specs/001-cloudflare-workers-js/data-model.md)
- [API Contracts](./specs/001-cloudflare-workers-js/contracts/)

## License

MIT

## Contributing

This is a personal-scale project (<1,000 links, single admin). For feature requests or bug reports, please open an issue.

## Acknowledgments

Built with [Cloudflare Workers](https://workers.cloudflare.com/), following official best practices from [Cloudflare documentation](https://developers.cloudflare.com/workers/).
