# 第二阶段验证记录与后续验收

测试命令 `bash supabase/tests/run-local.sh`：创建新本地Docker PostgreSQL16容器，无端口映射；固定已验证镜像digest，测试密码在运行时随机生成，不写入仓库；退出时清理容器。Python3为并发测试的唯一额外运行条件，不引入应用依赖。

自动化文件：

- local-bootstrap.sql：简化Auth fixture +受限迁移管理员，不能用于真实Supabase。
- rls_foundation.sql：原基础RLS测试保留，在新增API迁移之前执行（避免用旧测试人工写权限绕过新trigger）。
- sync_api.sql：在已部署新增迁移的隔离DB中执行角色、API、业务、事务、分页和墓碑断言，fixture与模拟清理全部ROLLBACK。
- concurrency.py：独立真实连接重叠事务，验证CAS胜者、并发相同ID重试和读取快照一致性；仅接受新本地测试容器ID，不接受数据库URL/密码。

## 覆盖场景

- 匿名拒绝EXECUTE，authenticated但无auth.uid也拒绝；A/B本人快照、游标隔离，B修改A习惯或备注失败；未知user_id/owner注入拒绝。
- 普通客户端没有业务表写入、私有表读取、私有helper执行或执行角色成员资格；执行角色没有SUPERUSER/BYPASSRLS/LOGIN/持久CREATE权限。
- 初始化8项事件；bootstrap和业务operation同ID重试不增加数据/版本/事件；同ID不同payload拒绝。
- 习惯新增+初始计划+排序原子创建，修改与陈旧version冲突；跨设备并发只一方成功且败方没有receipt。
- 字符串实体ID、initial:<habitId>计划ID、紧凑JSON note ID、旧毫秒createdAt及V1.1 schedule对象兼容；周一边界及weekday_mask映射，历史保留/未来计划ID不可替换。
- 打卡true/false事件与备注独立；总体总结；类别删除仅解除关联；归档撤销当天打卡、保留备注；习惯删除级联墓碑/排序移除，禁止复活。
- 完整排序CAS与重复ID拒绝，未来日期和非法周期拒绝，预设分类保护。
- 整批第二操作触发CHECK失败：前面业务/事件/游标回滚。另注入receipt存储异常：已经产生的业务/事件也全部回滚，operation ID能在修复后重试。
- 固定H分页，页之间新增不混入旧H；重复同参数得到同页，新变更在下一轮可读；retained_after模拟清理后游标过期、边界游标恢复。
- 快照在未提交写入之后等待并返回相匹配的实体version与游标。

## 边界与未验证项目

本地Auth.uid用会话变量模拟身份，**不验证JWT签名、GoTrue邮件认证、真实Supabase角色限制或Data API schema暴露**。SQL测试不等于HTTP/JWT测试；没有连接生产Supabase。没有完整前端、离线IndexedDB队列、迁移stage/commit或真实iPhone测试，不能声称已具备完整多设备产品。

本阶段完整JSON备份迁移仍不开放：旧ID/字段兼容不等于可以导入所有历史计划。历史计划写入受保护，未来导入必须经过单独预览与事务RPC，不绕过本阶段限制。

对大型用户数据，full_snapshot与级联墓碑可能形成较大的事务/响应；事件当前不清理、receipt永久保留，需后续配额/维护评审。事务级用户锁优先保证一致性，同用户写入串行；真实平台需要观察超时、死锁和限流。基础RLS外，新增trigger禁止无operation上下文的管理员在线手写，维修必须遵守维护方案。

## 本次实际结果（2026-10-09）

- 隔离PostgreSQL16基础RLS和新增API断言：通过；两份migration在NOSUPERUSER/NOBYPASSRLS迁移管理员下执行成功。
- 真实重叠连接并发场景：3组全部通过。
- 现有单元测试：41/41通过。
- Chromium浏览器回归：14/14通过。
- type-check、format:check、生产build、shell语法及diff空白检查：通过。
- 开发期间修正测试脚本括号错误；权限收尾验证发现PG16禁止向自己的grantor反授ADMIN，已改为保留创建者的既有管理授权并增加断言。随后完整重跑通过；结果使用最后完整运行，不拼接不同轮次的成功数。

新增sync-api.yml让push/PR中的数据库变更执行相同隔离测试，没有生产连接或部署步骤。GitHub Actions远端结果尚未观测，不能称CI已经通过。浏览器套件只验证现有本地网站回归，不验证云同步；真实隔离Supabase/电脑/iPhone验收步骤见 sync-api-operations.md。
