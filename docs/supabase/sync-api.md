# 安全同步 API v1（第二阶段）

基线 main `f8e22d0`。新增 `202610090002_sync_api.sql`，基础迁移不变；沿用字符串 ID、各实体 version、软删除、事件、receipt和每用户游标。没有引入 Supabase 前端 SDK、登录界面、IndexedDB队列或自动迁移。

## 权限和事务模型

四个公开RPC：`bootstrap_user`、`apply_operations`、`full_snapshot`、`pull_changes`。仅 authenticated EXECUTE；每个入口直接或通过 apply_operations 检查 auth.uid()。不接收 user_id；任意未知字段（包括owner/version/服务端时间/任意SQL）拒绝。公开发布key不能绕过JWT和RLS。

SECURITY DEFINER所有者为独立 `habit_rpc_owner`：NOLOGIN、NOSUPERUSER、NOBYPASSRLS、NOINHERIT，不是表所有者，不授予客户端成员身份；函数 search_path固定为空，表、函数业务对象全限定。只对11张既有表授予SELECT/INSERT/UPDATE，无DELETE、无持久schema CREATE。专用所有者RLS仍要求 auth.uid()=user_id；helpers/trigger函数的PUBLIC/anon/authenticated EXECUTE显式撤销。迁移管理员保留专用角色的ADMIN成员资格，以便未来修复/撤销函数权限（PG16角色管理需要ADMIN OPTION）；这只给执行迁移的可信管理员，不给authenticated/anon。目标角色schema CREATE只在转移所有权期间临时授予，提交前撤销。

写请求先按用户获取事务advisory lock（覆盖首次初始化尚无sync_head的情形），再锁sync_head FOR UPDATE。所有实体操作、版本时间trigger、事件追加和receipt写入同事务。批次任意错误使整个批次回滚，不会消耗operation ID；不返回伪成功。事件按每用户last_sequence递增，没有序列号提前分配后晚提交的问题。

本迁移对基础表新增业务trigger：没有有效身份/operation上下文的手工写入也会拒绝。管理员修复不是常规写API，必须按维护方案锁定用户、生成一致事件，不能直接绕过trigger进行在线写入。角色没有BYPASSRLS并不等于生产平台角色已验证：本地已在受限迁移管理员/执行角色下运行，真实Supabase仍需隔离项目确认角色管理权限。

## RPC 参数

### bootstrap_user

参数 `p_operation_id: UUID`、`p_timezone: IANA时区（默认Asia/Shanghai）`。初始化本人profile、6项固定preset-N分类、空排序和sync_head，产生8条事件；同operation ID重试返回原receipt。不自动读取或上传浏览器数据。已有完整初始化时不重复创建、不修改时区；时区变更用profile_update。已有profile却缺head/order返回bootstrap_state_incomplete，需管理员审核修复，不偷偷重建历史。

### apply_operations

参数 `p_operations` 为1～100项数组，整个JSONB表示最多256 KiB。每项：

```json
{
  "operation_id": "00000000-0000-4000-8000-000000000001",
  "type": "category_create",
  "expected_version": "0",
  "data": { "id": "opaque-string-id", "name": "学习笔记" }
}
```

operation_id必须是UUID；**实体ID仍为字符串**。expected_version是规范十进制字符串（不是JS number），0表示该实体尚不存在。版本比较包含墓碑，不允许用0复活已有已删除实体。

| type                   | data 必须包含的字段                                                                 | expected_version 指向      | 行为                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------- |
| bootstrap              | timezone                                                                            | 0（首次）                  | 推荐用专用wrapper                                                         |
| profile_update         | timezone                                                                            | profile                    | 校验pg_timezone_names，旧日期不重解释                                     |
| category_create/update | id,name                                                                             | category                   | 自定义分类创建/完整名称更新；预设不可修改                                 |
| category_delete        | id                                                                                  | category                   | 解除关联并墓碑，保留习惯                                                  |
| habit_create           | id,name,color,category_id,created_date,created_at_ms,plan_id,schedule,order_version | habit=0，另检查排序version | 创建习惯+初始计划+追加全局顺序同事务；旧createdAt毫秒需安全整数           |
| habit_update           | id,name,color,category_id                                                           | habit                      | 完整可编辑字段，不改创建日期或历史计划；归档只读                          |
| habit_archive          | id                                                                                  | habit                      | 按账号今天归档，撤销当天打卡；备注保留                                    |
| habit_delete           | id                                                                                  | habit                      | 习惯、计划、打卡、备注墓碑，排序移除；不物理删除                          |
| plan_set               | habit_id,id,schedule                                                                | 下周一计划（无则0）        | 日期由服务器计算；已有未来计划ID固定，历史保留                            |
| completion_set         | habit_id,date,completed                                                             | habit/date自然键           | true/false目标状态；禁止未来/非计划日，归档打卡只读                       |
| note_set               | habit_id（可null）,date,body                                                        | habit/date自然键           | null为总体总结；未计划日允许笔记；空/纯空格body生成墓碑，再写需同实体版本 |
| reorder                | ids（所有未删除习惯的去重完整ID数组，含归档）                                       | 全局order行                | 一条版本CAS；不接受外用户、遗漏或重复ID                                   |

schedule与现有domain一致：`{"kind":"daily"}`、`{"kind":"weekdays","days":[1,3,5]}`、`{"kind":"weeklyQuota","count":3}`。days用ISO周一1至周日7，服务端映射掩码；每周N次允许任意有效日，但不混入每日统计。新习惯created_date允许合法历史日期，不自动移动旧日期；plan_set仅下周一，不能借此写过去计划。

habit_create还需 `order_version` 字符串（首次初始化是"1"），防止新建与排序并发覆盖。同批后续操作需提供前一步或事件级联后的版本，不假定其他实体级联没有版本变化。

结果：`{"results":[{"operation_id":"…","status":"committed","from_cursor":"8","cursor":"9"}]}`。服务器对完整JSONB操作取SHA-256，忽略对象键顺序、保留数组次序和目标值；同ID/同payload返回完全相同receipt，同ID/不同payload拒绝。失败操作没有receipt，修正后可以重试；已发送操作在outbox中不可换payload。未实现客户端三方合并，同目标不同操作ID也需版本匹配。

**receipt游标是提交回执，不是客户端已应用事件的游标。** 多设备写入和重试可能返回旧cursor，不能直接跳过pull_changes；批次receipt只确认操作是否提交，必须拉取/应用所有事件后推进缓存cursor。

### full_snapshot

无参数；要求先bootstrap。锁head FOR SHARE直到读完，返回 `api_version:1,cursor,profile,categories,habits,schedules,completions,notes,order,imports`。集合包含墓碑，撤销打卡为completed=false；客户端展示过滤删除项，但同步缓存保留。profile/order为对象，其他集合为数组。version/cursor为字符串，created_at_ms经写API限制为JS安全整数。

这是云传输格式，**不是**可直接传给parseSnapshot的v2备份。未来适配器按类别/习惯/计划/date组合键生成NormalizedSnapshot：过滤墓碑、false打卡、将order数组映射整数顺序、重建JSON打卡ID、weekday_mask转days、category_id转categoryId、毫秒与日期保持。完整本地JSON导入预览、历史计划导入/staging、备份恢复仍未实现；不可用本API逐项盲目复制旧快照。

### pull_changes

参数：`p_after`字符串（首次"0"），`p_high_water`字符串或null，`p_limit`整数1～500（默认100）。首次null固定本用户H；后续每页必须复用H，只调整after=next_cursor。返回 events（sequence、entity_type、entity_key、version、payload、operation_id）、high_water、next_cursor、has_more。

按`after < sequence <= H`、sequence升序读不可变镜像。写入发生在页之间时只影响下一轮H；同参数重试给相同页（前提日志尚在保留范围内）。SHARE锁同时协调维护保留边界。单页可能切分同一operation的多个实体事件；客户端可逐页持久化下载进度，但应完整接收到H后才发布一致的衍生domain快照，或以operation_id分组延迟发布，不能把中间级联状态当作完整快照。after小于retained_after返回full_resync_required；本阶段不主动删除事件或receipt，游标默认永不过期，但检测路径已实现。未来管理员保留清理需同事务锁head、设置floor、删<=floor事件；禁止单独删日志。客户端全量重同步前保存未上传队列并重基，不能直接覆盖。

## 错误合同

| SQLSTATE / message                                | 客户端处理                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 42501 / authentication_required 或权限拒绝        | 暂停写队列，重新认证；匿名没有EXECUTE                                                                    |
| PT409 / version_conflict                          | PostgREST自定义409；detail为本人current行及current_version字符串；保留本地候选，用户解决后新operation ID |
| PT410 / full_resync_required                      | PostgREST自定义410；detail包含保留边界；安全完整重同步                                                   |
| 55000 / bootstrap_required                        | 先显式初始化本人资料                                                                                     |
| 55000 / bootstrap_state_incomplete                | 停止写入，管理员检查旧数据一致性；不自动修复                                                             |
| 22023/22P02/22003/P0001/23514等输入或业务校验错误 | 展示具体message；修正数据，不无限重试                                                                    |
| operation_id_reused_with_different_payload        | 检查outbox协议错误，不替换已发送payload                                                                  |
| 40P01/40001真实数据库死锁/序列化失败              | 同ID原payload退避重试，整个事务已回滚                                                                    |

PostgREST HTTP映射需要在隔离Supabase项目验证；本地SQL测试验证SQLSTATE/消息与数据结果，没有调用生产HTTP API。未来客户端不得把所有数据库失败都显示为“已同步”。

## 范围

支持安全业务写、版本、软删除、日志、回执、全量和增量读、过期检测。未实现云端导入stage/commit、历史计划恢复、账户删除、日志自动清理、PWA、认证前端、离线队列UI、自动冲突合并、Realtime。仍保持V1.1本地网站行为和localStorage原文。
