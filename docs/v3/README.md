# V3 阶段 2：修订审批资料（尚未批准）

修订基线 **c2b32362a5a6fa3f785d4171c1cbe73fbf96ba6e**。阶段1产品不变；本轮仅修订草案、数据库本地测试与浏览器测试竞态，不执行任何真实 SQL、不改 Auth/Data API、不部署、不合并 main。

- [实际架构、事件模型比较与推荐字段](database-design.md)
- [RPC、记录反馈与统计口径](api-and-statistics.md)
- [审批事项、备份恢复及人工步骤](migration-review.md)
- [验证结果与 CI 根因](validation.md)
- SQL：`supabase/proposals/202610190001_v3_expansion.sql`（**不是 migrations 下的自动迁移**）
- 只读：`supabase/checks/v3-review.sql`、`v3-data-integrity.sql`
- 本地隔离验证：`python3 supabase/tests/run-v3.py empty` / `upgrade`

## 对上版提案的实质修订

| c2b3236 旧草案             | 本次修订                                                       |
| -------------------------- | -------------------------------------------------------------- |
| 数值目标统一 actual≥target | goal_direction 分离 at_least/at_most/tracking_only             |
| 每日 add/set 总量命令      | 独立 event_id + 不可变 record/revise/void 修订，指定行为可撤销 |
| 单日总量 revision          | 单事件 revision，操作 UUID 负责网络重试幂等                    |
| 没有发生时间与细目         | occurred_at、明细/审计分页 RPC、原子事件批次                   |
| 未记录隐式为0              | at_most过去缺确认是unknown，显式日终确认才可明确0次            |
| 数值达标均可庆祝           | 区分记录保存、正向达标、上限待结算；tracking不达标             |
| 数值≥目标计算所有统计      | 所有统计共用方向状态，待结算和tracking独立，不混入成功         |

## 再次审批的具体取舍

1. 保留两张原表，增加一张长期保留的事件修订表及调用者权限视图；不恢复复杂增量同步。
2. 类型/方向/目标/单位创建后固定；目标变化归档新建。数字历史允许在归档有效日期内修正，Boolean归档语义不变。
3. 计时为整数分钟，计数为整数次数；每事件和每日上限1440分钟/1000000次。Emoji是十项预设。
4. at_most必须日终确认记录完整，历史修正使确认失效；未确认不自动成功。纯记录型无连续/徽章。
5. 补记和历史修正会重新计算、可能撤回历史徽章；普通后续断签保留历史徽章。
6. 新增10个业务 RPC（包括批量和明细），保留原五个Boolean接口；旧客户端不会显示数值习惯。
7. 先另行批准独立Supabase测试项目迁移和Data API配置；真实云端验收通过后，才讨论应用数据库迁移及阶段3 UI。

当前请勿执行草案。测试的模拟claim不是Supabase JWT验签，CI绿色也不构成云端安全验收。
