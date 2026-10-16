# 两表迁移权限复核（2026-10-16）

修正文件仍为 `supabase/migrations/202610110001_mobile_cloud.sql`，在 feat/mobile-cloud-tracker 分支。用户尚未在真实项目执行，所以直接最小修改此未应用迁移；不修改旧001/002，不增加业务表或SECURITY DEFINER角色。

## 授权结论

打卡授权拆为两条：

```sql
grant insert(habit_id,date) on habit_mobile.habit_checkins to authenticated;
grant delete on habit_mobile.habit_checkins to authenticated;
```

实际PG17测试也确认原先的 `GRANT INSERT(habit_id,date),DELETE` 组合语法可执行，**没有复现原句语法错误**。本次拆开让列权限和表权限边界明确，不把未复现的问题报告成数据库语法漏洞，也不扩权。

|操作|最小权限及实际依赖|
|---|---|
|新建习惯|INSERT(id,name,color)，user_id由auth.uid默认填充，created_date/created_at由默认值与trigger填写。无需这些受保护列的INSERT|
|重试新建|ON CONFLICT DO NOTHING + SELECT；不需要user_id INSERT或整表UPDATE。固定ID同内容重试仅保留一条|
|编辑/归档|UPDATE(name,color,archived_on)及SELECT；FOR UPDATE仅需存在UPDATE列授权，日期/身份受trigger限制|
|打卡|INSERT(habit_id,date)，其余字段默认/trigger填充；唯一冲突DO NOTHING，无需checkins UPDATE|
|取消|表DELETE及WHERE使用列的SELECT；trigger仍检查本人、习惯状态及日期|
|RPC|五个入口EXECUTE、schema USAGE；均SECURITY INVOKER，不能越过列授权或RLS|
|触发器|trigger创建时由迁移owner检查函数执行权限；触发时无需向客户端授予两个trigger函数EXECUTE，函数仍用调用者权限访问表|
|外键|迁移管理员须REFERENCES auth.users；复合外键把打卡绑定到同一用户习惯。普通客户端不需要Auth GRANT OPTION|

客户端无user_id INSERT/UPDATE、created_date UPDATE、checkins UPDATE、习惯DELETE及trigger函数EXECUTE。表级和列级权限均有自动断言。触发器赋值不等于客户端显式写这些列，不需要放宽INSERT。RLS与FORCE RLS保持，schema中恰好两张业务表。

## 实际验证

本地临时PostgreSQL17.11容器，无端口暴露，无远程URL，使用简化Auth stub和非超级用户迁移管理员；管理员没有Auth USAGE/EXECUTE的GRANT OPTION。

- `bash supabase/tests/run-mobile.sh empty`：无habit_api/private/mobile的新数据库安装通过；仅预置本地Auth模拟对象，不能等同真实Supabase。
- `bash supabase/tests/run-mobile.sh legacy`：保留旧schema和sentinel数据后安装通过，已有数据不变。
- 两种模式：默认身份/日期/时间、全部RPC、唯一性、重试、归档保留当天历史、取消、A/B隔离、跨用户归档拒绝、日期校验、FORCE RLS、函数权限与列权限断言通过；每模式4组重叠会话通过。
- 安装在全部表/函数/策略/授权创建之后注入除零异常，完整事务回滚，habit_mobile schema及对象均不存在；再模拟缺失REFERENCES，早期失败同样回滚；恢复本地fixture授权后正常安装通过。
- 业务事务中先打卡再触发CHECK错误，打卡回滚。
- 重复执行已安装迁移安全拒绝，已有数据数量不变；这不是“可反复成功执行”，不要重放迁移。
- 原组合GRANT在本地回滚测试内实际执行通过，拆分后的最终授权通过相同功能与权限断言。

7个现有单元测试、TypeScript和生产构建本轮通过，shell语法和git diff检查通过。前端代码未变化，本轮未重跑浏览器测试。真实Supabase/PostgREST/GoTrue/JWT签名验证和iPhone没有执行；GitHub远端CI未观测。

## 用户下一步

先在habit-tracker-test运行只读 `supabase/checks/mobile-state.sql`。若habit_mobile不存在，审核当前完整SQL后只人工执行202610110001_mobile_cloud.sql；不要执行旧001/002或db push全部迁移。已有habit_mobile则先清点，不重复安装、不删对象、不覆盖数据。

真实测试项目需确认authenticated的auth USAGE/auth.uid EXECUTE、迁移角色CREATE schema/REFERENCES、Data API暴露habit_mobile、真实A/B JWT读写隔离及归档/取消操作。已有详细步骤见implementation.md。本次没有连接或修改任何远程数据库，没有执行迁移、合并PR或部署。等待用户手动操作。
