# V3 阶段 2 数据模型修订（二次审批）

## 真实基线与审计范围

代码基线 c2b32362；运行中的阶段 1 基于 3274c2e。只审查仓库 SQL，未查询真实 Supabase。基础 migration 为 `202610110001_mobile_cloud.sql`，两张业务表 habits、habit_checkins；五个 RPC 为 create_habit/edit_habit/archive_habit/set_checkin/read_snapshot。ID 是字符串；打卡唯一键为 user_id/habit_id/date；复合外键防止跨账号关联。触发器保护身份、北京时间日期、归档；两表 RLS + FORCE RLS，RPC 为调用者权限并限定空 search_path。TypeScript 仍是 Boolean Habit/Checkin/Snapshot，不在本阶段接入数值 UI。

现有 Boolean 历史足够计算历年热力图、周/月率、连续与徽章，但没有数值、Emoji、顺序或行为时间。原提案每日 add/set 日志不能还原某一次行为，不能满足指定记录撤销，现已替换，尚未安装旧草案的项目不存在日志转换问题。

## 推荐模型与替代方案

| 方案                                            | 成本与复杂度                                                | 明细和审计                                                   | 结论                       |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| 统一数值事件：一行为一 event_id，记录其修订版本 | 一张追加表、最新事件及每日聚合视图；客户端持有事件 revision | 可以还原每次行为和全部修正；重试 operation_id 与行为 ID 分离 | 推荐，手机端长期使用最清晰 |
| 每日数值进度命令 add/set                        | 初期简单；指定事件撤销需要反向增量、引用、CAS 和额外映射    | 只能解释每日总数；set 会抹去行为归属，后续补丁越来越复杂     | 不采用                     |
| 可变事件表 + 独立命令回执/审计表                | 至少两张新表，多处原子写入                                  | 清晰但维护两份状态，体量及权限面更大                         | 当前没有必要               |

**落地是逻辑上独立的行为事件、物理上不可变的事件修订日志**，不是把每日累计命令改个名字。progress_operations 每行是一条对某事件的不可变命令回执；event_id 稳定标识行为，operation_id 稳定标识一次提交。habit_events 取每事件最新版本，可还原明细；habit_daily_progress 仅汇总最新且未 void 的 occurrence。没有另一份可写总量，避免双重真相。

## 字段与关系

habits 新增 emoji（默认🌱）、sort_order（bigint）、habit_type（boolean/duration/count）、goal_direction（at_least/at_most/tracking_only）、target（integer，可空）、unit。旧行默认 Boolean + at_least +1 +completion，原列原值和时间戳不 UPDATE 回填。类型、方向、目标、单位创建后不可改，需归档新建以免重解释历史。

- Boolean 固定 at_least/1/completion，仍只用原 habit_checkins。
- Duration 整数分钟，Count 整数次数，单位只允许 minute/repetition；每次及每日总量上限分别 1440/1000000，防负数、非整数、溢出。达到上限后仍可撤销/向下修正。
- at_least 目标必须为正；at_most 可为零；tracking_only 目标必须 NULL。记录值与方向完全分离。
- Emoji 只接受十个精确 Unicode 预设，不接受 HTML/控制字符/任意组合，默认🌱。这是有限选择，并非任意 Emoji 编辑器。
- 排序新习惯追加 max+1024，旧 rank=0 用 created_at/id 稳定排序；归档保留原 rank，不在活跃拖拽集合。完整 ID 列表 CAS（最多500）原子更新，冲突提示重新读取并回滚拖拽，不静默覆盖。

progress_operations：user_id、operation_id（用户内主键）、event_id、event_kind（occurrence/day_confirmation）、habit_id（复合用户外键）、date、action（record/revise/void）、input_value、occurred_at（行为时间）、expected_revision、revision、created_at（服务器接收时间）、confirmed_revisions（服务器生成的当日event_id→revision完整映射，仅确认行使用）。唯一(user_id,event_id,revision)，一日只允许一个逻辑 confirmation，后续用 revise 重新确认。

record 创建 revision1；revise 精确修正指定事件值/同日发生时间；void 撤销指定事件，必须回传该事件当前值/时间和revision，不能借撤销改写载荷，也不能复活已撤销事件。所有旧版本保留，明细默认展示最新未撤销行为，审计页可查看所有版本和撤销状态。日期/habit/kind 不能在一个 event_id 上变更；日期修正必须用批量 RPC 原子 void 旧事件+record 新事件，保留两条之间的批量回执供客户端解释。没有服务器批次 ID 字段，前端需持有该批请求操作 ID 列表；跨会话审计只能逐条看到原始回执，不能声称已有持久批次关联。

## 日期、零值与完整性确认

全部业务日期固定 Asia/Shanghai（UTC+8），不跟随手机时区；occurred_at 为有时区绝对时间，date 必须与其北京日期一致，不允许未来时间、创建前或归档后日期。跨午夜的计时需按北京午夜拆成两条事件，以批量事务保存；本阶段不实现后台计时器。数字习惯归档后允许对有效历史日期修正/补充/确认，不能记录归档后的日期；旧 Boolean 归档仍只读，兼容原规则。

零次行为没有 occurrence 行。**没有行不等于确认零次**：过去 at_most 没有确认时为 unknown，不奖励自动成功，也不当失败。用户需在日期结束后确认该日记录完整（day_confirmation，值0）；此时无行为才代表明确零次。今天不能确认日终。记录或撤销/修正行为会改变最新事件版本映射，使旧确认失效，必须重新确认。确认比较精确JSON版本集合，不依赖设备时钟、数据库时间戳精度或服务器时钟回拨来判断先后。追补历史是用户声明，不是服务器对真实行为的证明。

今天 at_most 未超过目标为 within_limit_pending；超过为 exceeded，绝不提前庆祝。北京次日0点以后，低于上限且确认完整才 completed。无需午夜定时写库，读取依据服务器 statement_timestamp 分类。tracking_only 只记录，没有成功/失败目标。

## 并发、安全与保留

所有新表 RLS/FORCE RLS，视图 security_invoker；authenticated 仅 SELECT 与输入列 INSERT，禁止日志 UPDATE/DELETE，用户/版本/接收时间由触发器生成。原始输入列 INSERT 也必须经过相同校验。无 SECURITY DEFINER、新角色、owner 变更、Auth 授权或 RLS 绕过。业务 RPC 九个，只有 authenticated 可执行。

每用户事务 advisory lock 串行化写入（非全局锁），两个新增独立 event 可相加不丢失；同一 event 修正用 expected_revision，失败40001；operation_id 同载荷重试返回原回执，不同载荷报错，归档后的原回执也可重读。批量1–100条同事务，任一失败全回滚；客户端网络重试必须保留相同 operation_id/event_id/时间/值，不能重生 ID 导致重复+1。

日志长期保留支持幂等与审计。事件量按每习惯每天10次估计，10习惯一年36500条；旧体量探针仍测54750条。年度摘要最多366行，不应下载完整命令日志。明细需按习惯/日期查询（本草案 read_snapshot_v3 只返回年度聚合，不返回全量事件；历史明细由 read_events_v3 有界分页读取）。尚无压缩或清理计划，真实项目需测 EXPLAIN 与长期增长。
