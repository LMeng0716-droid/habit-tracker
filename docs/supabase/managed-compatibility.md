# Supabase 托管环境兼容性复核（2026-10-11）

## 已知事实与风险

用户在 SQL Editor 确认：PG17.11、执行角色 postgres，两个业务 schema 和专用角色不存在；可以 CREATE schema、REFERENCES auth.users，但不能转授 auth USAGE 或 auth.uid EXECUTE。没有远程连接或执行迁移。当前审核基于 main bd7b169。

001 无须修改：外键 REFERENCES 权限已确认；创建表/schema、FORCE RLS 和业务对象授权由其 owner 执行。仍需确认 postgres 的实际 CREATE ROLE/角色成员管理能力以执行 002。

旧版 002 的两个 Auth GRANT 没有保证有效。PostgreSQL 可能仅产生 `no privileges were granted` 警告而继续提交，留下不能访问 auth.uid 的 SECURITY DEFINER owner。我们在本地 PG17.11、相同四项权限组合下复现旧版 RPC 的 `permission denied for schema auth`。这是**高：安装可表面成功但写入不可用**的问题，未发现跨用户读取漏洞。真实项目的 PUBLIC auth USAGE 尚未知；若 PUBLIC 已有访问，表现可能不同，不能声称旧版已经在真实 Supabase 执行失败。

## 最小修改与权限方向

只调整 002 的 Auth 授权区块；001、数据表、业务操作、函数 owner、search_path 和 RLS 口径不变：

1. 若迁移角色具备两项 Auth GRANT OPTION，沿用直接授权，owner 保持 NOINHERIT。
2. 否则：验证 authenticated 不是 LOGIN/SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB 角色、没有父角色成员关系、不能 CREATE habit_api 或访问 habit_private；将 owner 设为 INHERIT，并执行 **GRANT authenticated TO habit_rpc_owner**，不给 ADMIN OPTION。
3. 无论哪条路径，最终检查 owner 实际 auth USAGE/auth.uid EXECUTE；不满足就抛错，整个 002 回滚。

成员方向绝不能颠倒。客户端 authenticated 没有获得新权限，更不能 SET ROLE habit_rpc_owner。备选路径让执行角色继承 authenticated 的全部已有权限，而非只继承两个 Auth 权限；真实项目须审核该角色在其他应用 schema 的既有权限。这里没有更改或扩大 authenticated 的 ACL。角色图异常直接拒绝安装，不自动修补平台角色。

PG16/17：CREATEROLE 足以创建受限角色，并自动赋予创建者 ADMIN；要 GRANT authenticated，还需要 authenticated 的 ADMIN OPTION。修改函数 owner 要能 SET ROLE 专用角色、目标 role 在函数 schema 临时有 CREATE；002 原有授权提供这些，提交前撤销 CREATE。托管平台附加限制仍需实测。若平台不允许上述操作，请停止，提交只读检查结果给管理员；不要改用 postgres/service_role 作为业务 RPC owner、关闭 RLS 或放开客户端表写入。

函数执行仍为独立 NOLOGIN/NOBYPASSRLS 非表 owner；FORCE RLS 及 auth.uid()=user_id 策略保持。authenticated 的继承策略与专用策略均限定同一 UID。所有业务函数空 search_path、对象名全限定；没有读取由客户端提供的 user_id。身份取自平台 auth.uid，而不是前端声明。

## 为何改动已合并的 002

本次仅针对**尚未执行**的安装：用户确认对象不存在，新增 003 无法修复 002 在它执行之前的权限依赖。最小修改保留原 migration 文件路径并修正安装过程。不重复执行已成功应用的 002，不自动改已有角色；已有环境若需要修复，先导出角色/ACL/迁移状态，再另写针对该状态的追加迁移。使用带校验和的迁移工具时须审核本次文件差异，不能自动接受历史校验变化。旧版“提交成功但 RPC 不可用”的环境也不能 DROP 后重装。

## 本地自动测试与真实环境的区别

测试镜像固定 digest，无端口映射，临时容器退出销毁。Auth 是 stub，迁移在非超级用户 CREATEROLE 管理员下执行；不是连接真实 Supabase，也不验证 JWT 签名、PostgREST 或 GoTrue。

新增 `managed` 测试配置撤销管理员两项 Auth GRANT OPTION，保留 CREATE schema/REFERENCES，授予其 authenticated ADMIN。新增迁移失败测试验证：旧版 Auth 权限故障可复现；异常父角色图、缺失 Auth USAGE、PG16/17 缺失 authenticated ADMIN 均拒绝，且 role、retained_after 和函数全部回滚。修正版随后通过全部 RLS、双用户 RPC、CAS、幂等、墓碑、分页、事务回滚和六组并发场景。另保留 `direct` 配置，检查原直接授权路径。

执行命令：`bash supabase/tests/run-local.sh <15|16|17> <direct|managed>`。CI 为三个版本、两个配置矩阵，远端 CI 状态未验证。具体本轮结果见 sync-api-validation.md。

## 独立 Supabase 测试项目人工步骤

1. 确認测试项目标识与 SQL Editor 项目，保留备份/迁移状态。只读执行 `supabase/checks/migration-preflight.sql`，不执行本地 Auth bootstrap/fixture。
2. 检查 PG15+、Auth 对象、postgres CREATEROLE、CREATE schema、REFERENCES；两项 GRANT OPTION=false 时，检查 authenticated 自身属性及父角色关系、auth USAGE/EXECUTE=true。PG17 检查 pg_auth_members 中 postgres 对 authenticated 的 ADMIN=true；若没有，不能断言可执行，应交管理员评估。预检输出也是证据，不能完全证明平台允许角色变更。
3. 审核当前分支的 002 差异。你的对象均不存在时，先人工执行完整 001，再执行修正版完整 002。001 成功而 002 失败：001 保留，002 事务回滚；记录错误，只修复依赖后重试 002，不重复 001，不删除数据，不忽略警告。SQL Editor 中若事务仍 aborted，先 ROLLBACK。
4. 提交后再执行只读预检与 sync-api-operations.md 的 owner/ACL 查询：owner 实际 auth 两项访问=true，客户端不能 SET ROLE owner；owner NOLOGIN/NOSUPERUSER/NOBYPASSRLS/非表 owner。备选路径 INHERIT=true、authenticated→owner 的成员记录无 ADMIN。客户端没有私有 schema、业务表写入权限；所有表 ENABLE/FORCE RLS，四个 RPC 的 EXECUTE 仅按已设计角色提供。
5. Data API 暴露 habit_api，保持 habit_private/auth 不暴露；确认 Auth 邮箱验证、Site URL/Redirect URL 仍为既有 GitHub Pages 地址。无需修改网站、提供服务器密钥或开启 Realtime。
6. 用两个真实验证邮箱 A/B、publishable key 和各自 JWT 验收匿名/过期/伪造 JWT 拒绝、跨用户读取/写入/冲突详情隔离、直接表修改拒绝、同 operation ID 重试、版本冲突、全量与固定水位增量分页、删除墓碑。这些必须通过真实 Data API，而不是 SQL Editor 模拟 UID。
7. 失败后保留数据库及 localStorage/备份，不自动清理 schema。若 002 已提交，必要时管理员撤销四个 RPC EXECUTE 暂停（精确 SQL 见 sync-api-operations.md）；向前修复，不重跑 002 或删除事件/receipt。

结论：**原版 002 不应按当前权限结果直接安装；修正版可在独立测试项目完成预检后人工试执行，但真实托管环境兼容性尚未验证通过。** 不批准生产迁移或部署。
