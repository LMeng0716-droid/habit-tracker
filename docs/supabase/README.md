# Supabase 与多设备同步设计（待人工审核）

本次只交付设计和基础 SQL；未连接 Supabase，未更改生产数据库、应用运行逻辑或 Pages 工作流。基础 SQL **不提供可用的同步写入 API**：需要完成后续原子 RPC 与验收后才接入前端。

- [main 代码审查](code-review.md)
- [ER、字段、权限与数据库约束](database.md)
- [认证、首次迁移、同步及冲突协议](sync-design.md)
- [控制台配置与静态部署](console-and-deployment.md)
- [分阶段计划与测试清单](implementation-and-tests.md)
- [待审核基础迁移](../../supabase/migrations/202610090001_sync_foundation.sql)
- [隔离数据库 RLS 测试脚本](../../supabase/tests/rls_foundation.sql)

所有云功能默认关闭，保留本地模式。只有用户主动登录、预览并确认迁移后，才允许上传对应账号的数据。注册成功不代表已完成云迁移。
