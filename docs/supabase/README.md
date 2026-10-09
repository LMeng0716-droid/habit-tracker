# Supabase 与多设备同步设计（待人工审核）

第一阶段交付设计与只读基础 SQL；第二阶段新增安全写/读 RPC，仍未连接真实 Supabase、修改应用运行逻辑或 Pages 工作流。基础迁移单独执行时没有写 API，需按顺序执行经审核的第二份迁移，再在隔离项目验收。

- [main 代码审查](code-review.md)
- [ER、字段、权限与数据库约束](database.md)
- [认证、首次迁移、同步及冲突协议](sync-design.md)
- [控制台配置与静态部署](console-and-deployment.md)
- [分阶段计划与测试清单](implementation-and-tests.md)
- [待审核基础迁移](../../supabase/migrations/202610090001_sync_foundation.sql)
- [隔离数据库 RLS 测试脚本](../../supabase/tests/rls_foundation.sql)

所有云功能默认关闭，保留本地模式。只有用户主动登录、预览并确认迁移后，才允许上传对应账号的数据。注册成功不代表已完成云迁移。

## 第二阶段：数据库 API

- [RPC参数、错误、幂等与分页合同](sync-api.md)
- [执行顺序、控制台权限、回滚恢复](sync-api-operations.md)
- [测试覆盖与验证边界](sync-api-validation.md)
- [新增API migration](../../supabase/migrations/202610090002_sync_api.sql)
