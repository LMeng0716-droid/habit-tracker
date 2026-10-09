# 数据库迁移与安全专项审核（2026-10-09）

## 审核基线与结论

远端 main 为 f8e22d0，仅包含 001；002 来自 efe6350（feat/supabase-sync-api），尚未合并。本审核分支基于该 API 分支，PR 对 main 因此也包含此前 API 工作。没有修改生产数据库、部署网站或修改前端/localStorage。两份迁移原文保留；没有确认需要修改业务 SQL 的安全缺陷，因此没有人为新增 003。

|问题|严重程度|处理|
|---|---|---|
|测试把 PG16 自动 ADMIN 成员授权作为所有版本必备条件，PG15 迁移成功却被误报失败|低：测试兼容性|仅 PG16 校验自动 ADMIN；PG15 的 CREATEROLE 管理能力不同|
|pg_isready 可在 Docker 初始化临时服务器上成功，随后服务器关闭，迁移偶发连接失败|中：测试可靠性|等待 PID 1 为最终 postgres 进程，再检查就绪|
|并发覆盖只有三组、权限检查仅抽查部分函数|中：验证缺口|新增三个并发场景、全函数 owner/search_path/权限及全表 RLS/权限断言；CI 使用 15/16 矩阵|
|真实 Supabase 平台角色管理、PostgREST 与 JWT 尚未验证|上线阻断条件，非已确认漏洞|人工隔离项目预检、迁移和真实 A/B JWT 验收后再评估生产|

## 权限与兼容性审核

001 → 002 在全新隔离 PostgreSQL 15/16、非超级用户 CREATEROLE 管理员下运行。001 的 UNIQUE NULLS NOT DISTINCT 要求 PG15+；SHA256、JSONB、触发器和锁均在两个版本执行验证。测试管理员有明确的 auth schema USAGE GRANT OPTION、auth.uid EXECUTE GRANT OPTION 及 auth.users REFERENCES，不能据此推定 Supabase SQL Editor 有相同权限。

002 新建 NOLOGIN/NOSUPERUSER/NOBYPASSRLS/NOINHERIT 专用角色；不是表 owner。四个公共 RPC 为 SECURITY DEFINER，所有函数固定空 search_path，业务对象显式限定 schema。临时 schema CREATE 在提交前撤销，PUBLIC/anon 无函数执行权限，authenticated 仅执行四个入口；私有 helper 不可直接调用。内部表无客户端权限，所有表 ENABLE/FORCE RLS，专用角色策略同样限定 auth.uid()。调用者不能在 payload 提供 user_id。迁移管理员是可信维护边界，不能将其成员权限交给客户端。

PG16 创建者自动取得新角色 ADMIN，002 普通 GRANT 保留该能力；PG15 的 CREATEROLE 行为不同，不应要求 pg_auth_members 中存在同一 ADMIN 记录。真实 Supabase 是否允许建角色、转移函数 owner 及转授 auth 权限必须在隔离项目确认，不能通过 SUPERUSER、BYPASSRLS 或 service_role 函数 owner 绕过失败。

## 一致性与事务审核

写入先取用户 advisory 事务锁，再锁 sync_heads FOR UPDATE；首次 bootstrap 没有 head 时仍串行。业务版本、事件、head 和 receipt 在同一事务中；异常整批回滚。重复相同 operation ID/JSONB payload 返回原 receipt，不同 payload 拒绝。CAS 冲突不写入 receipt；失败操作可以修复后重试。网络重试验证为相同 RPC 重发及真实并发重复提交，未模拟 HTTP 响应丢失。

full_snapshot/pull_changes 取 head FOR SHARE，与写入互斥。默认 READ COMMITTED 下等待写事务后，后续读取得到匹配数据/水位。已复现“写先于快照”“快照先于写”“写先于增量读取”，未发现数据与游标不匹配。固定 high_water 分页测试覆盖页间新写入、重复页、下一轮读取及过期游标。一个操作可跨页，消费者须收到 H 后再发布镜像，不可把每页当完整业务事务。写 receipt cursor 不代表客户端下载已完成。

归档撤销当天打卡并保留备注；取消打卡以 completed=false 同步；删除级联产生墓碑、移除排序；重复周期只修改下周一计划、保留历史。事件/receipt 当前永久保留，无自动压缩。committed_at 使用事务开始时间，不是全局提交顺序；唯一排序依据为用户 sequence。不要以时间戳增量同步。

多语句显式事务若先持读锁再升级写锁，可能遇到 PostgreSQL 死锁；REPEATABLE READ/SERIALIZABLE 也可能出现 40001。客户端必须重试完整事务、保留 operation ID，不能宣称所有隔离级别永不失败。此次自动并发测试覆盖默认 READ COMMITTED，未覆盖压力、锁超时及所有隔离级别。

## 自动验证与未验证

原 rls_foundation.sql 仅验证基础表 RLS，必须在 002 前执行；002 的 RPC、receipt、trigger 和游标通过 sync_api.sql/concurrency.py 验证。JWT 身份为会话变量 stub；真实并发指多个 PostgreSQL 连接，不指真实 Supabase 登录。

最终命令与结果见 sync-api-validation.md。未自动验证：真实 JWT 签名/过期/伪造拒绝、GoTrue、Data API、平台 owner/role 限制、iPhone、HTTP 网络故障、生产容量。旧字符串 ID/计划格式兼容已测试，但完整旧 JSON 历史导入 RPC 尚未实现，不可批量手写历史数据绕过保护。

## 用户下一步与失败恢复

1. 建立独立 Supabase 测试项目，不使用生产数据库；备份并记录项目标识/迁移状态。
2. SQL Editor 以实际迁移管理员执行只读 `supabase/checks/migration-preflight.sql`，确认 PG15+、Auth 对象、CREATEROLE、转授权限。若 001 已执行，确认 schema owner；不要重跑它。
3. 新项目按 **001 → 002** 人工执行；已有 001 只执行 002。严禁执行 local-bootstrap.sql 或本地 fixture。迁移失败事务回滚，记录精确错误；不 DROP 数据，不降级权限。已提交对象保留，修复应追加迁移。
4. Data API 暴露 habit_api，保持 habit_private/auth 不暴露；核查 authenticated USAGE、四个 RPC EXECUTE、仅业务表 SELECT 和所有 RLS。Auth 邮箱验证及 GitHub Pages 回调保持现有配置；无需 Realtime。
5. 注册并验证 A/B 两个邮箱，用公开 publishable key + 各自真实 JWT 调用四个 RPC；按 sync-api-operations.md 测试跨用户读写、匿名/过期 JWT、直接表写入拒绝、CAS、重复提交、墓碑和分页。额外确认 B 的冲突详情不包含 A 数据。不要将密钥/JWT 写入仓库或报告。
6. 失败时保持本地备份/待发队列。若已提交需暂停，仅由管理员撤销 RPC EXECUTE，不删表、事件或 receipt；恢复步骤及精确撤权 SQL 见 sync-api-operations.md。生产操作需另外明确授权。

可以开始在**独立 Supabase 测试项目**执行上述预检和迁移；这不是生产上线许可，也不代表已验证平台配置。
