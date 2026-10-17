# 每日进步 · 手机端习惯追踪器

React + TypeScript + Vite，Supabase Auth 登录，PostgreSQL 保存习惯和每日打卡。更换手机或清除浏览器后，登录同一账号读取云端历史。手机端优先，提供创建、编辑、归档、打卡/取消、历史日历、连续天数和完成率。

本分支将旧localStorage应用替换为云端产品；没有迁移、读取或删除旧本地数据。暂不提供分类、备注、排序、自定义周期、离线队列或复杂同步。现有生产网站不会因分支修改自动发布。

## 本地运行

Node.js 24、npm，执行 `npm ci`。按 `.env.example` 配置 `.env.local`，仅填入独立测试项目的HTTPS URL和公开publishable key；执行 `npm run dev`，访问 `/habit-tracker/`。开发模式未配置时显示云端设置提示；生产构建缺少配置会停止。

## 数据库安装与安全

先在独立项目执行只读 `supabase/checks/mobile-state.sql`。新产品仅人工执行 `supabase/migrations/202610110001_mobile_cloud.sql`，使用独立habit_mobile schema、habits/habit_checkins两张表、RLS和SECURITY INVOKER RPC。

**不要执行全部历史migration，不要使用db push重放旧001/002，不要删除已存在的schema。** 旧复杂同步SQL和文档仅作历史审计留存，不是新方案安装依赖。

完整权限、部分初始化处理、Auth/Data API配置、部署边界和人工验收见 [实施说明](docs/mobile/implementation.md)，测试记录见 [验证记录](docs/mobile/validation.md)。

## 验证

- `npm test`：日期/统计/云端模型。
- `npm run type-check`、`npm run format:check`、`npm run build`。
- `npm run test:e2e`：移动尺寸浏览器，通过模拟API调用真实SDK；不是验证真实JWT。
- `bash supabase/tests/run-mobile.sh`：本地临时PostgreSQL17容器的RLS、事务和并发测试，无远程连接。

GitHub Pages base保留 `/habit-tracker/`。经另行审核部署时，在GitHub Actions Variables配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。禁止提交service_role、secret key或数据库密码。本次不自动部署、迁移或合并。

公开配置现在必须通过构建前校验。格式规则、GitHub Variables设置和真实Supabase逐步验收见 [配置与验收](docs/mobile/config-and-acceptance.md)。仅缺失配置时可在开发模式查看设置提示；生产构建会停止。

独立预览第一阶段已提供仅构建artifact的流程，目标base为`/habit-tracker-preview/`，不发布站点。正式base和部署流程保持不变。参见 [预览构建与存储隔离](docs/mobile/preview-stage1.md)。
