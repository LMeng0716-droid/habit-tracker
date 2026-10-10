# 第二阶段：控制台、执行顺序和恢复

本次没有连接真实Supabase，以下必须由用户在隔离测试项目先审核执行。不能把本地测试通过视为生产项目已配置完成。

先阅读 [专项审核](security-audit.md)，在独立项目运行只读 `supabase/checks/migration-preflight.sql`。PG15 的 CREATEROLE 与 PG16 自动 ADMIN 行为不同；本地已分别执行验证，但平台能力仍需实测。

## 执行前检查

1. 备份测试/生产数据库并保留已有迁移记录；先在隔离项目验证，再另外授权生产动作。所有迁移一次性执行；已有schema/role/function同名会失败并回滚，禁止通过DROP现有数据来“修好”。
2. 确认PG15+、Supabase auth.users/auth.uid存在、anon/authenticated是预期角色。迁移管理员应拥有基础表/schema，并有CREATEROLE与必要auth.uid EXECUTE/schema USAGE的GRANT OPTION。若平台不允许创建/转移独立角色，停止并联系管理员，不改成service_role、表owner或BYPASSRLS来绕过。
3. 本地已用NOSUPERUSER/NOBYPASSRLS的 managed_migration_admin执行两份迁移，写函数则在不同NOLOGIN/NOBYPASSRLS角色下运行，覆盖权限误设风险；仍需在真实隔离Supabase确认平台角色限制和PostgREST映射。

## SQL顺序

- 没有基础schema的项目：先人工执行 `202610090001_sync_foundation.sql`，再执行新增 `202610090002_sync_api.sql`。
- 已经完成第一份的项目：只执行第二份；不要重复执行基础迁移，不修改其内容。
- 不要把 `supabase/tests/local-bootstrap.sql`、测试fixture、注入故障trigger或测试临时grant复制到Supabase SQL Editor。它们仅用于独立本地PostgreSQL容器。
- 第二份包含BEGIN/COMMIT，新增role、policies、trigger、函数、retained_after列和EXECUTE grant同事务提交；可信迁移管理员保留role ADMIN成员资格供后续维护，前端角色从未获得成员身份；失败全部回滚。NOTIFY刷新PostgREST schema缓存，不触发网站构建。

## Supabase控制台与权限确认

1. Data API启用；Exposed schemas添加`habit_api`并保留已知需要的现有schema。`habit_private`、`auth`不暴露。关闭自动暴露新表并不代替手动schema配置。
2. 客户端 authenticated 仅需 `USAGE habit_api`、基础8表SELECT、4个RPC EXECUTE。迁移已提供这些权限。anon/PUBLIC没有这些函数的EXECUTE；客户端不得得到表INSERT/UPDATE/DELETE、私有schema USAGE或habit_rpc_owner成员资格。
3. RLS保持ENABLE/FORCE。新增rpc_owner策略给专用执行角色，仍需auth.uid()=user_id；普通authenticated策略不变。确认所有者不是postgres/service_role，不具有SUPERUSER/BYPASSRLS/LOGIN，不具有schema CREATE。
4. 登录后用公开publishable key+用户JWT调用 `habit_api` RPC；supabase-js使用`.schema('habit_api')`，POST的Content-Profile应为habit_api。URL是项目HTTPS URL，前端只允许publishable key；不需要数据库密码/secret/service_role。
5. Email provider、邮箱验证、密码策略和SMTP配置按上一阶段控制台文档复核；Site URL和Redirect URLs保持精确 `https://lmeng0716-droid.github.io/habit-tracker/`，不带消息中的`**`或业务hash。本次没有Auth trigger或自动上传逻辑，也未改回调。
6. 无需Realtime publication；轮询pull_changes即可。没有日志自动清理，没有额外数据库扩展依赖（SHA256使用PostgreSQL内置函数）。

人工权限查询可在隔离项目SQL Editor运行只读检查：

```sql
select rolname, rolcanlogin, rolsuper, rolbypassrls
from pg_roles where rolname='habit_rpc_owner';
select has_schema_privilege('authenticated','habit_api','USAGE'),
       has_schema_privilege('authenticated','habit_private','USAGE'),
       has_table_privilege('authenticated','habit_api.habits','UPDATE'),
       has_function_privilege('authenticated','habit_api.apply_operations(jsonb)','EXECUTE');
-- 预期 true, false, false, true。
select p.oid::regprocedure, r.rolname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname in ('habit_api','habit_private');
```

## 隔离项目人工API验收

A/B各注册真实邮箱并确认；每人bootstrap；A新增习惯和记录，B full_snapshot/pull_changes只能见本人，B用A实体ID更新/写备注失败且不得返回A内容。匿名/过期JWT调用失败，直接表PATCH/DELETE失败。A两个浏览器提交同一旧version只有一个成功；同operation ID同payload返回原receipt，不同payload拒绝。固定H分页时另一端写入只出现在下一轮H。归档、分类删除和习惯删除均有完整级联事件与墓碑。SQL Editor使用管理员角色测试不能代替这些真实JWT请求。

## 回滚与恢复

- 新migration未提交失败：整个数据库事务回滚，检查精确错误并在测试项目修正后重试，不清空schema或降权限控制。
- 已提交需暂停服务：管理员先撤销这4个RPC的authenticated EXECUTE（精确签名见migration末尾），暂停客户端同步；保留所有表、墓碑、版本、事件、receipt和本地队列。read/full_snapshot可按故障范围单独保持/撤销，不将旧前端接到可写表。
  经明确授权需要暂停API时，可由具有专用函数owner管理权限的管理员使用以下精确权限撤销；不删除对象或数据：

```sql
begin;
revoke execute on function habit_api.bootstrap_user(uuid,text),
  habit_api.apply_operations(jsonb),habit_api.full_snapshot(),
  habit_api.pull_changes(text,text,integer) from authenticated;
notify pgrst, 'reload schema';
commit;
```

- 不提供会DROP表/墓碑的自动down migration。优先追加向前修复迁移，在隔离恢复副本验证后再审核；恢复数据库旧备份会使已提交receipt/游标回退，必须停写、保存客户端待发队列并强制全量重同步，不能自动重放旧请求假定已提交记录仍在。
- 不直接删事件/receipt。若以后确需事件保留清理，管理员同事务先锁sync_head FOR UPDATE，确定所有<=F事件清理后不可恢复，设置retained_after=F，再删<=F事件；离线设备收到PT410先备份本地队列。receipt本阶段永久保留，避免旧重试二次执行。
- 基础项目已有手工插入但不完整的数据返回bootstrap_state_incomplete：暂停、备份、检查profile/order/head与已有事件，建立经审核的修复脚本；不可把last_sequence重置0或静默补空历史。
- 不改localStorage，不启用现有网站云模式，不在本PR修改Pages工作流、配置实际密钥或部署。未来网站接入需要另一个审核PR。
