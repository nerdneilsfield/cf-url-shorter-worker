# 配置指南

[English](./CONFIGURATION.md) | [中文](./CONFIGURATION_zh.md)

本文档说明如何为你的域名和环境配置 URL 短链接服务。

## 概览

URL 短链接服务需要在两个地方进行配置：

1. **wrangler.toml** - Cloudflare Workers 配置（路由、绑定、环境变量）
2. **Wrangler Secrets** - 管理员 token（加密存储）

## 快速配置

```bash
# 1. 复制模板
cp wrangler.example.toml wrangler.toml

# 2. 编辑 wrangler.toml - 替换 YOUR_DOMAIN 和资源 ID

# 3. 设置密钥
wrangler secret put ADMIN_USER
wrangler secret put ADMIN_PASS
```

## 域名设置

### 支持的域名类型

| 类型 | 示例 | 区域名称 | 匹配模式 |
|------|------|---------|---------|
| 子域名 | `short.example.com` | `example.com` | `short.example.com/*` |
| 短子域名 | `s.example.com` | `example.com` | `s.example.com/*` |
| 备选域名 | `link.example.com` | `example.com` | `link.example.com/*` |
| 顶级域名 | `yourdomain.com` | `yourdomain.com` | `yourdomain.com/*` |

### wrangler.toml 配置

```toml
name = "url-shortener"
main = "worker/src/index.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# ⚠️ 必填：替换 YOUR_DOMAIN
routes = [
  { pattern = "YOUR_DOMAIN/*", zone_name = "YOUR_DOMAIN" }
]

# ⚠️ 必填：设置运行时使用的域名
[vars]
DOMAIN = "YOUR_DOMAIN"

# D1 数据库绑定
[[d1_databases]]
binding = "DB"
database_name = "URL_SHORTENER_DB"
database_id = "YOUR_D1_DATABASE_ID"  # 来自：wrangler d1 create

# KV 命名空间绑定
[[kv_namespaces]]
binding = "CACHE_KV"
id = "YOUR_KV_NAMESPACE_ID"  # 来自：wrangler kv namespace create

# Workers Analytics Engine 绑定
[[analytics_engine_datasets]]
binding = "ANALYTICS"

# 定时任务触发器（UTC 时间凌晨 2 点每日清理）
[triggers]
crons = ["0 2 * * *"]
```

## 配置示例

### 示例 1：子域名 (short.example.com)

```toml
routes = [
  { pattern = "short.example.com/*", zone_name = "example.com" }
]

[vars]
DOMAIN = "short.example.com"
```

**DNS 配置：**

- 类型：A
- 名称：`short`
- IPv4：`192.0.2.1`（虚拟 IP）
- 代理：✅ 已启用（橙色云）

### 示例 2：顶级域名 (yourdomain.com)

```toml
routes = [
  { pattern = "yourdomain.com/*", zone_name = "yourdomain.com" }
]

[vars]
DOMAIN = "yourdomain.com"
```

**DNS 配置：**

- 类型：A
- 名称：`@`
- IPv4：`192.0.2.1`
- 代理：✅ 已启用

### 示例 3：本地开发

本地开发时域名无需匹配生产环境：

```bash
# 启动本地开发服务器
wrangler dev --local

# 访问地址 http://localhost:8787
# 管理界面：http://localhost:8787/admin/
# 健康检查：http://localhost:8787/health
# 重定向：http://localhost:8787/YOUR_SLUG
```

`.dev.vars` 中的本地凭据：

```env
ADMIN_USER=admin
ADMIN_PASS=local_password
```

## 多环境配置

### 多个环境（预发布/生产）

#### 预发布环境

```toml
[env.staging]
name = "url-shortener-staging"
routes = [
  { pattern = "staging.short.example.com/*", zone_name = "example.com" }
]

[env.staging.vars]
DOMAIN = "staging.short.example.com"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "URL_SHORTENER_DB_STAGING"
database_id = "YOUR_STAGING_D1_ID"

[[env.staging.kv_namespaces]]
binding = "CACHE_KV"
id = "YOUR_STAGING_KV_ID"
```

**部署到预发布环境：**

```bash
wrangler deploy --env staging
```

#### 生产环境

```toml
[env.production]
name = "url-shortener"
routes = [
  { pattern = "short.example.com/*", zone_name = "example.com" }
]

[env.production.vars]
DOMAIN = "short.example.com"

[[env.production.d1_databases]]
binding = "DB"
database_name = "URL_SHORTENER_DB"
database_id = "YOUR_PROD_D1_ID"

[[env.production.kv_namespaces]]
binding = "CACHE_KV"
id = "YOUR_PROD_KV_ID"
```

**部署到生产环境：**

```bash
wrangler deploy --env production
```

### 各环境的密钥

```bash
# 预发布环境密钥
wrangler secret put ADMIN_USER --env staging
wrangler secret put ADMIN_PASS --env staging

# 生产环境密钥
wrangler secret put ADMIN_USER --env production
wrangler secret put ADMIN_PASS --env production
```

## Cloudflare 控制台配置

### 1. 添加域名

1. 访问 [Cloudflare 控制台](https://dash.cloudflare.com)
2. 点击 **添加站点**
3. 输入你的域名
4. 按照 DNS 配置步骤操作

### 2. 配置 DNS

**子域名 (short.example.com)：**

| 类型 | 名称 | 内容 | 代理 |
|------|------|------|------|
| A | short | 192.0.2.1 | ✅ 已代理 |

**顶级域名 (example.com)：**

| 类型 | 名称 | 内容 | 代理 |
|------|------|------|------|
| A | @ | 192.0.2.1 | ✅ 已代理 |

### 3. 验证路由（可选）

如果路由无法工作，手动添加：

1. 进入 **Workers & Pages**
2. 选择你的 Worker
3. 进入 **设置** → **触发器**
4. 添加路由：`YOUR_DOMAIN/*`

## 密钥管理

### 生产环境密钥（Wrangler Secrets）

```bash
# 设置密钥（生产环境）
wrangler secret put ADMIN_USER
# 输入：your_admin_username

wrangler secret put ADMIN_PASS
# 输入：your_strong_password

# 列出密钥
wrangler secret list

# 删除密钥
wrangler secret delete ADMIN_USER
```

### 本地密钥 (.dev.vars)

仅用于本地开发：

```env
# .dev.vars（不要提交）
ADMIN_USER=admin
ADMIN_PASS=dev_password
```

⚠️ **重要提示：**

- `.dev.vars` 已在 `.gitignore` 中
- 仅用于 `wrangler dev --local`
- 生产环境使用 `wrangler secret`

## 验证清单

配置完成后，验证以下各项：

### 配置

- [ ] 已从模板创建 `wrangler.toml`
- [ ] 在 `routes` 和 `DOMAIN` 变量中配置了域名
- [ ] 已创建 D1 数据库并添加 ID
- [ ] 已创建 KV 命名空间并添加 ID
- [ ] 已配置定时任务触发器

### DNS

- [ ] 域名已添加到 Cloudflare
- [ ] DNS 记录已配置
- [ ] 代理已启用（橙色云）
- [ ] DNS 传播完成：`dig YOUR_DOMAIN`

### 密钥

- [ ] 通过 `wrangler secret` 设置管理员 token
- [ ] 已配置本地 `.dev.vars`（可选）

### 部署

- [ ] 已应用迁移：`wrangler d1 migrations apply`
- [ ] 已部署 Worker：`wrangler deploy`
- [ ] 健康检查正常：`curl https://YOUR_DOMAIN/health`

### 功能

- [ ] 管理界面可访问：`https://YOUR_DOMAIN/admin`
- [ ] 可以使用 token 登录
- [ ] 可以创建链接
- [ ] 重定向正常：`curl -I https://YOUR_DOMAIN/test`
- [ ] 分析已记录

## 故障排查

### 问题：Workers 路由不匹配

**症状：**

- 访问域名返回 Cloudflare 错误
- Worker 未拦截请求

**解决方案：**

1. 验证域名已添加到 Cloudflare
2. 检查 DNS 传播：`dig YOUR_DOMAIN` 或 `nslookup YOUR_DOMAIN`
3. 验证 `wrangler.toml` 中的路由模式包含 `/*`
4. 在控制台检查路由：Workers & Pages → Worker → 触发器
5. 等待 1-2 分钟让路由传播

### 问题：无法访问 /admin/

**症状：**

- 访问 `/admin/` 时出现 404 错误
- 管理界面无法加载

**解决方案：**

1. 验证 `admin/` 目录存在，包含 `index.html`、`styles.css`、`app.js`
2. 检查 Worker 部署：`wrangler deploy --dry-run`
3. 验证 Worker 正在提供静态资源
4. 检查浏览器控制台错误

### 问题：Worker 中 DOMAIN 未定义

**症状：**

- 缓存操作失败
- 错误提示 `undefined` 域名

**解决方案：**

1. 验证 `wrangler.toml` 中的 `[vars]` 部分：

   ```toml
   [vars]
   DOMAIN = "your-actual-domain.com"
   ```

2. 重新部署：`wrangler deploy`
3. 如果使用 `[env.xxx]`，检查环境特定变量

### 问题：数据库/KV 未找到或表不存在

**症状：**

- 错误：`D1_ERROR: no such table: links: SQLITE_ERROR`
- 关于缺少数据库或 KV 的错误
- API 调用时出现 500 错误
- `wrangler d1 migrations apply` 显示"无需迁移"但表不存在

**解决方案：**

1. 列出资源并检查远程数据库：

   ```bash
   # 列出所有数据库
   wrangler d1 list

   # 检查远程（生产）数据库中的表
   wrangler d1 execute URL_SHORTENER_DB --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
   ```

2. 如果 `links` 表不存在，手动执行迁移：

   ```bash
   # 对远程数据库执行迁移
   wrangler d1 execute URL_SHORTENER_DB --remote --file=migrations/0001_create_links.sql
   ```

3. 验证 `wrangler.toml` 中的 ID 与创建的资源匹配
4. 验证绑定（`DB`、`CACHE_KV`、`ANALYTICS`）正确

**重要提示：**
- 不加 `--remote` 参数只会操作本地数据库
- 生产环境必须使用 `--remote` 参数

### 问题：401/403 认证错误

**症状：**

- 无法登录管理界面
- API 返回 401 或 403

**解决方案：**

1. 重新设置密钥：

   ```bash
   wrangler secret put ADMIN_USER
   wrangler secret put ADMIN_PASS
   ```

2. 本地开发时，检查 `.dev.vars` 文件
3. 清除浏览器缓存/Cookie
4. 尝试不同浏览器/隐身模式

## 安全最佳实践

### 可以提交的内容

✅ **可以提交：**

- `wrangler.example.toml`（带占位符的模板）
- `.dev.vars.example`（模板）
- D1 数据库 ID（非敏感）
- KV 命名空间 ID（非敏感）
- 公共域名

❌ **禁止提交：**

- `wrangler.toml`（包含你的域名）
- `.dev.vars`（包含凭据）
- 代码中任何位置的 `ADMIN_USER` / `ADMIN_PASS` 值
- `.wrangler/` 目录

### 推荐的 .gitignore

```
# Wrangler
.wrangler/
.dev.vars
wrangler.toml

# 依赖
node_modules/

# 环境
.env
.env.local

# 操作系统
.DS_Store
```

### Token 轮换

**定期轮换管理员 token：**

```bash
# 更新生产环境密钥
wrangler secret put URL_SHORTER_ADMIN_TOKEN

# 无需重新部署 - 密钥立即更新
```

## 高级配置

### 自定义定时任务时间表

在 `wrangler.toml` 中更改清理频率：

```toml
[triggers]
crons = ["0 */6 * * *"]  # 每 6 小时
# 或
crons = ["0 0 * * *"]    # 每天 UTC 午夜
# 或
crons = ["0 2 * * 0"]    # 每周日 UTC 时间凌晨 2 点
```

### 性能调优

在 `worker/src/services/cache.js` 中调整缓存 TTL：

```javascript
// KV 缓存 TTL（边缘缓存持续时间）
cacheTtl: 120  // 默认：2 分钟

// 负缓存 TTL（404 只缓存在各 PoP 的 Cache API 中，不写入 KV）
export const NEGATIVE_CACHE_TTL = 300;  // 默认：5 分钟
```

### 自定义分析保留期

Workers Analytics Engine 的保留期由 Cloudflare 管理（通常为 30-90 天）。无法按项目配置。

## 参考资料

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 数据库](https://developers.cloudflare.com/d1/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)

## 需要帮助？

- 查看 [SETUP_zh.md](./SETUP_zh.md) 了解分步设置说明
- 查看 [README_zh.md](./README_zh.md) 了解项目概览
- 查看 [quickstart.md](./specs/001-cloudflare-workers-js/quickstart.md) 了解测试场景
