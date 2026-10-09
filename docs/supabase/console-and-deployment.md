# 控制台配置和 GitHub Pages 部署

以下由用户在**隔离测试 Supabase 项目**先操作并验证，再审核决定生产动作。本任务不执行这些配置。Dashboard界面标签可能随版本变化，请按设置项含义查找。

1. 确认 Email provider、邮箱验证（Confirm email）开启状态；用户只说明“Email登录”已配置，不能推断验证、密码策略、SMTP均已就绪。核对密码强度、邮件发送限额、验证码/链接有效期，生产发送配置自有SMTP及发信域名；SMTP密钥只留Supabase设置。注册和重置邮件各发一封实际验证。
2. Authentication URL Configuration：Site URL 保留 `https://lmeng0716-droid.github.io/habit-tracker/`；Redirect URLs包含相同完整URL。用户消息末尾的 `**` 是格式标记，不能填入URL。增加本地调试精确地址时仅用于隔离测试项目，不添加任意通配生产域名；PKCE回调直接回根路径，不加业务hash。授权操作前保留已有URL，不替换未知列表。
3. 先人工审核 `supabase/migrations/202610090001_sync_foundation.sql`；本地PostgreSQL验证不替代Supabase测试项目验收。迁移一次性创建新schema，名称存在会失败并回滚，不在已有对象上盲目DROP/覆盖。通过CLI或SQL Editor执行只能由后续用户明确授权；本任务没执行远端SQL。
4. **关闭自动暴露新表时的 Data API**：确认项目Data API本身启用；在API/Data API设置中，把 `habit_api` 加入 Exposed schemas，保留已有schema，绝不暴露 `habit_private`/`auth`。schema存在、暴露名单、角色schema USAGE、具体表SELECT、RLS是五个不同步骤，缺一不能访问；基础迁移已显式grant USAGE及指定8张表SELECT to authenticated、revoke anon/PUBLIC，并ENABLE/FORCE RLS。不要手工“grant all to anon”或授予未来所有表权限。
5. 使用登录用户JWT调用 `/rest/v1/habits`，GET用 `Accept-Profile: habit_api`；未来写/RPC用适当 `Content-Profile: habit_api`。supabase-js客户端设 `db: {schema:'habit_api'}` 或 `.schema('habit_api')`。未配置schema默认public会报告找不到表；已暴露但无grant为权限错误；RLS查询到0行不代表配置失败。迁移会NOTIFY pgrst reload schema；若仍缓存旧元数据先诊断，不关RLS试错。
6. 基础迁移**允许认证用户读取自己的已有行，但没有写权限，也未创建RPC**。在后续写RPC迁移与安全测试完成前，不要给前端开放表INSERT/UPDATE/DELETE，不启用云模式。不需要Realtime即可轮询同步；后续若启用只评审特定业务表/事件提示，不能暴露私有事件流。
7. Settings API keys：取项目HTTPS URL和前端publishable key。不要使用service_role、secret key、数据库连接密码、JWT签名secret。公开key通常sb_publishable_…，以控制台标注的publishable类型为准，不用“看起来像JWT”判断安全性；RLS是最终权限边界。

## 静态构建合同（未来前端实施）

Vite构建变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`，另用非敏感 `VITE_CLOUD_SYNC_ENABLED=false`默认关闭。所有 VITE_ 都会进入浏览器bundle，不是保密存储。URL/key可放GitHub Actions Repository/Environment variables并在build步骤注入；本次不修改Actions，也不添加真实值或.env文件。不要将服务端secret通过Actions Secret注入VITE变量。

静态站点没有运行时服务端secret保管能力；修改配置需要重新构建、审核后发布。启动验证缺失/无效配置时保持本地模式并解释原因，不上传数据；不把生产项目用于自动测试。base继续 `/habit-tracker/`，Auth初始化先于hash路由，回调使用根路径与现有Pages部署兼容。

客户端输入密码直接经TLS交给Supabase Auth，不保存到localStorage、不日志记录；access/refresh token由SDK会话管理，任何JS可读的浏览器会话存储都存在XSS风险。保持React文本渲染，不渲染备注原始HTML，后续评估CSP（包括Supabase连接域）、依赖与邮件链接，不把token记录到错误遥测。

参考文档（需在实际配置时复核当前控制台版本）：

- https://supabase.com/docs/guides/api/using-custom-schemas
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/sessions/pkce-flow

本环境尝试只读获取官方网页未成功；以上为参考链接，未声称已验证控制台现状或用户项目配置。
