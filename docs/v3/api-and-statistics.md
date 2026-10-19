# V3 API、记录反馈与统计口径（二次审批）

## API 差异

旧五个函数签名不变，只服务 Boolean；旧 snapshot 隐藏数值习惯，避免旧 UI 错误打卡。原列和原打卡不迁移/不删除。旧应用不会自动获得 V3 数值展示能力。

新 RPC：

| 名称                             | 契约                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| create_habit_v3                  | 原参数后增加 p_direction；tracking_only 必须 p_target=NULL                                                 |
| edit_habit_v3 / archive_habit_v3 | 修改名称/颜色/Emoji或归档，目标和方向不可变                                                                |
| reorder_habits_v3                | 完整活跃ID集合 + expected列表，值比较CAS，同目标重试成功                                                   |
| record_progress_v3               | operation UUID + event UUID + habit/date/action/value/occurred_at/expected_revision/kind；不是每日 add/set |
| record_events_v3                 | 1–100个上述事件命令，事务原子批次，返回每条原始回执                                                        |
| read_snapshot_v3                 | 最多366天 Boolean历史 + 数值每日聚合，元数据含所有归档习惯                                                 |
| read_events_v3                   | 指定习惯、一天，按event UUID keyset分页；可看最新状态或审计版本；无跨页快照保证，修改时重读该日            |
| read_summary_v3                  | 最多366天，due/completed/pending/tracking/exceeded 与完成率                                                |
| read_streaks_v3                  | 完整历史派生连续/徽章，不限于365天                                                                         |

共10个新业务 RPC（edit/archive 分别计），不暴露 require_user_v3/guard_*。函数调用者权限 + 空 search_path，非离线同步协议。事件返回的 revision 是单事件版本，不是日总量版本。批量跨日期修正必须整体重试，原操作UUID始终复用。

## 反馈和目标判断

保存每次行为只提示“已记录 +1”等；云端未确认不能成功提示。取消/撤销提示“已撤销记录”。at_least 仅从未达标到达标且成功写入才播放完成庆祝；tracking_only 从不播放目标达成庆祝；at_most 今天只显示“未超过上限”或“已超标”，确认昨日完整并达标可提示昨日目标达成，绝不冒充今日完成。载入/刷新/跨账号恢复不触发庆祝。该契约供后续 UI 阶段实现，本轮不修改现有 Boolean 庆祝。

## 统一统计

有效区间为 created_date ≤ date ≤ archived_on（归档日含），未归档上限为北京今日。创建前/归档后无计划，不进入分母。每个习惯状态：

- Boolean：原记录存在即 completed，否则 incomplete，语义完全不变。
- at_least：最新未撤销事件之和≥目标即 completed，否则 incomplete（缺记录计0）。
- at_most：超上限为 exceeded；今日未超限为 within_limit_pending；过去未超限但缺少有效完整性确认为 unknown；只有已结束且有效确认且未超限为 completed。
- tracking_only：recorded 或无记录状态，仅展示次数和明细，无达标/失败/连续。

`tracking`统计有效纯记录习惯数，并非记录条数；是否发生行为看 progress/event_count，缺记录不能画成“已记录”。

`due` 是可判定目标数（Boolean/at_least、at_most已确认或明确超标）；pending独立计数，tracking独立计数，不进入due。完成率=completed/due，due=0为NULL，不能显示100%。今日at_most超标进入分母但不成功，未超标仍待结算；界面须同时显示待确认数，不能以一个百分比暗示全日完成。跨周/月聚合用总completed/总due，不平均每日百分比。自然周为北京时间周一至周日，自然月为公历月；未结束周期明确标注截至今日及待结算数量。

热力图最近365天含今日（today-364到today），接口允许最多366天处理闰年。用同一统计状态：无有效目标/仅tracking、待结算或未知、未完成/超标、部分完成、全部完成；有pending不得画“全部完成”，tracking以记录点或独立图层展示，不能混进绿格分母。数量单位不混加，分钟和次数独立显示，取消了无意义的统一 actual/target 进度百分比。

连续与7/21/30徽章按每习惯连续completed日期。at_most今日pending允许承接昨天但不加天；未知日中断已验证连续，不伪装失败。tracking连续为0、无徽章。最长连续使用全历史，普通后续断签保留已验证历史徽章；修正/撤销历史或确认失效后重新派生，可能撤回。徽章读取不触发播放。归档只保留有效历史。日终确认和历史修正是产品新增交互，须用户批准。

## 历史读取与性能边界

事件明细按单习惯单日、limit≤100、UUID游标分页，审计模式按(event_id,revision)复合游标；读取不具有复杂同步快照语义。新增记录/修正并发期间前端重读该日；不得把游标当增量同步或全库一致备份。年度摘要从同一语句快照读取，数值派生不存在另一个可变总量来源。真实托管环境JWT、RLS、Data API选择与耗时均待独立项目验收。
