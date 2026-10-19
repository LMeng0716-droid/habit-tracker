# RPC、统计与客户端兼容协议

## 旧 API 兼容

保持五个 RPC 名称、参数及返回大体形状，不建立同名重载：

| 旧 API | 草案中的行为 |
|---|---|
| create_habit(id,name,color) | 仍创建 Boolean；默认 Emoji 🌱。同 ID 相同名称/颜色重试不会重置已编辑 Emoji |
| edit_habit | 仅编辑 Boolean 名称/颜色，保留 Emoji；数值类型要求 V3 客户端 |
| archive_habit | 仅 Boolean，重复归档安全；历史和归档当天打卡保留 |
| set_checkin | 仅 Boolean，仍为“设为目标状态”而非反转；唯一约束不变 |
| read_snapshot | 仍返回完整 Boolean 历史及原 today/habits/checkins 键，不把数值部分进度当打卡；新列被旧 TS parser 忽略 |

数值习惯在旧快照隐藏；旧页面也不会显示新 Emoji 或应用 V3 排序，仍保持其原有顺序/默认图标。旧客户端完成率/庆祝只涵盖 Boolean，不能代表 V3 全部目标；这属于可读兼容，不是功能兼容。新客户端必须先识别 API 能力，数据库未批准时不能发送 V3 RPC 或宣称 Emoji/排序已云端保存。

如果正式网站仍是旧 localStorage 版本，它不调用 Supabase，因此不会受 SQL 影响；若已是旧云端版，则按上述范围继续工作。仓库源代码不证明线上当前产物版本，本轮不修改或发布两站。

## 新业务 RPC（全部在 habit_mobile）

| 名称与输入 | 输出/错误 |
|---|---|
| create_habit_v3(p_id text,p_name text,p_color int,p_emoji text='🌱',p_type text='boolean',p_target int=1,p_unit text='completion') | 完整习惯 JSON，含排序/模式；字符串 ID 不改 UUID；同创建参数重试返回原对象，不匹配则 id_already_used |
| edit_habit_v3(p_id,p_name,p_color,p_emoji) | 完整习惯；无类型/目标/单位修改参数 |
| archive_habit_v3(p_id) | 任意模式归档，重复安全，保留历史 |
| reorder_habits_v3(p_ids text[],p_expected_ids text[]) | `{ids,unchanged}`；全活跃集合原子排序；order_conflict / invalid_order_ids |
| record_progress_v3(p_operation_id uuid,p_habit_id text,p_date date,p_action text,p_value bigint,p_expected_revision bigint=NULL) | 不可变原始回执 value_after/revision；add 不传版本，set 必须传；operation_id_reused / revision_conflict / value_out_of_range |
| read_snapshot_v3(p_start date=今天-364,p_end date=今天,p_habit_id text=NULL) | api_version:3、today/start/end、全部习惯元数据及范围内 Boolean checkins/数值 progress；可只取一个习惯明细；最多含首尾 366 天 |
| read_summary_v3(p_start,p_end,p_habit_id=NULL) | 最多 366 个日期聚合点和区间合计，不需要把所有习惯/日期明细传给热力图 |
| read_streaks_v3() | 每习惯 current/longest 和已解锁阈值及最早 achieved_on；基于完整历史，不限最近 365 天 |

helper require_user_v3 只供数据库嵌套调用；guard_* 仅为触发器。Dashboard 不把它们列为新增业务入口。所有函数参数/返回字段均需在阶段 3 建独立 V3 TS 类型；现有 domain.ts 与页面本轮不改，不提前开发新 UI。

建议类型：

```ts
type HabitMode =
  | { habit_type: "boolean"; target: 1; unit: "completion" }
  | { habit_type: "duration"; target: number; unit: "minute" }
  | { habit_type: "count"; target: number; unit: "repetition" };
type DailyProgress = {
  habit_id: string;
  date: string;
  actual_value: number;
  revision: number; // <= Number.MAX_SAFE_INTEGER
};
```

UUID 只用于数值操作 ID，绝不替换现有 habit text ID。数据库值域保证 target/actual/revision 在 JS 安全整数范围，仍需客户端 unknown 解析及范围检查。

## 新客户端写入约定（设计，未实现）

1. 每次用户动作生成一个稳定 operation_id；网络重试复用同 ID 和负载。成功回执可能是旧版本，不能覆盖较新状态；读视图/快照对账。
2. 不把每次重连生成新 ID 的 add 称为幂等。页面重开后若丢失未确认请求 ID，先读最新数值并让用户核对，不自动补发。没有离线写入队列。
3. 同日 add 累计由服务器串行化，不依赖客户端先读后写。set 保留用户看到的 revision；冲突时恢复服务器值，让用户决定新的修正。
4. Boolean 仍用 set_checkin；Duration/Count 不另写 habit_checkins。达到目标从统一计算判断，不能以日志行存在判完成。
5. 拖动/上移下移都是一次完整数组排序 RPC，保存中区分未确认/已确认，失败回读服务器列表，不部分提交。
6. 只有当前账号、当前操作仍有效时才更新 UI/庆祝；沿用阶段 1 epoch 和操作序号。数值首次跨阈值才庆祝，继续加量不重复；回读历史不播放解锁动画。
7. 所有错误以 SQLSTATE+稳定 message 判定；不要假定 PostgREST 一定把 40001 映射为 HTTP 409。40001/40P01 或未知网络结果都先对账。

## 热力图与完成率

业务日期固定北京时间字符串 YYYY-MM-DD，不用浏览器本地午夜重新解释旧日期。默认过去 365 天为 `[今天-364,今天]`；选定日历年支持闰年 366 天。SQL 读区间含首尾，禁止未来终点/颠倒/超过 366 天。

每天有效习惯集合：created_date<=日期<=今天，且 archived_on 为 NULL 或 日期<=archived_on。创建前、归档后、未来日期不计分母。归档当天沿用 V1 包含规则，归档后该历史只读。

- Boolean 完成：合法日期存在 checkin。
- Duration/Count 完成：合法日期最新 actual_value>=固定 target。
- 日完成率：完成习惯数/应完成习惯数；无有效习惯时为 NULL/“无数据”，不是失败或 100%。
- 区间完成率：Σ完成任务/Σ应完成任务，不是每天百分比的不加权平均。
- progress_rate：平均目标进度，先把每项 actual/target 截在 0..1；与二值 completion_rate 明确区分。150/120 显示进度最多 100%，实际 150 保留。
- 完成数量不混入分钟/次数；actual_minutes 与 actual_repetitions 分开返回。单习惯平均每日量=该习惯实际量合计/有效日期数；全部习惯某模式平均=该模式实际量合计/至少一项该模式有效的日期数（根据每日 duration_due/count_due 是否大于 0），不除以混合习惯任务总数。无有效日期为 NULL。
- 最近 7 天 `[今天-6,今天]`，30 天 `[今天-29,今天]`；本周从周一到今天，本月从一日到今天，跨年不靠周数相等判断。今天未结束，标注“截至现在”；若做已结束日趋势，终点改昨天并明确标签，不能静默混用。
- 聚合热力图：due=0 无数据；completed=0 未完成；0<completed<due 部分完成；completed=due 全完成。目标进度深浅是另一种可选指标，要另行标明。
- 尚未拿到一致数据时显示加载/失败，不用 0 伪装新账号。read_summary 每次一条 SQL 一致快照；不同 RPC 之间不承诺同一时刻，写入后相关图表应一起重新读取，不引入复杂增量同步。

## 连续天数与徽章

current：今天完成则从今天回溯，否则从昨天回溯，今天尚未完成不立刻毁掉当前连续。归档习惯以 archived_on 为锚点。longest 是全部有效完成日期的最长连续段，不截在最近一年。

7/21/30 天徽章以第一次达到阈值的日期为 achieved_on（连续段开始+阈值-1）；不统计分钟数累计为天数。后续断签、刷新、换手机、归档不丢失仍有历史证据的徽章。主动修正/取消获奖期间历史导致连续段消失时，会撤回派生徽章。这项取舍必须获批准；“永不撤回”需要解锁事件持久化，本轮未新增成就表。

页面启动读取到已存在徽章仅展示，不播放解锁动画。将来只有当前操作确认、阈值从未达到变为达到时才庆祝；不能把本地解锁提示标记当云端成就真源。

## 读取量与性能

旧 read_snapshot 全量 Boolean 历史不做静默截断，否则会破坏旧日历/最长连续天数。V3 首页应主动请求今天/最近短区间，年度图使用 read_summary_v3（365/366 聚合点），单习惯详情按 p_habit_id 读取，避免每次打卡重传全年全部明细。最长连续/徽章走服务端完整历史聚合，无需为了最早徽章传回所有事件。

日志索引 `(user_id,habit_id,date,revision DESC) INCLUDE(value_after)` 支持每日最新读取；PK 同时提供用户过滤/幂等查找，复合唯一键保证版本唯一。日志需要保留，不提供随意 TTL 清理；清除旧事件会破坏回执幂等与历史真源。未来数据量显著增长时先实测压缩/归档或受审阅的每日快照方案，不增加未验证的缓存双写。

本地体量探针用 10 个数值习惯、1825 天、每日 3 次、54750 行日志，比较年度明细与年度聚合 JSON 大小及完整五年连续记录。性能是本地 PostgreSQL+Docker 证据，不是 Supabase 托管延迟保证；真实数据库须在独立项目检查 EXPLAIN、请求响应大小、网络耗时和套餐限制。
