# 阶段 2 审批、执行与恢复清单

**当前状态：SQL 草案，本轮不执行任何远程迁移。以下是审批后的人工步骤，不是本轮已完成操作。**

## 需要用户明确批准

- 接受 README 中的目标/单位不可变、三种模式及上限、Emoji 白名单、排序 CAS 和派生徽章撤回规则。
- 接受一张不可变数值操作表+调用者权限视图，操作记录长期保留。
- 修改原五个 RPC 以保护 Boolean 兼容；旧云端页面不显示数值习惯。
- 接受新增八个业务 RPC 及 helper/触发器，保持 SECURITY INVOKER/RLS。
- 确认独立测试项目、备份及恢复途径；先测试后另行决定真实应用数据库变更窗口。
- 单独授权控制台 Data API 暴露配置；本轮未改设置。

本阶段交付后停止，不自动进入阶段 3/4。批准设计不等于授权立即修改生产数据库。

## 执行顺序

1. **明确项目身份**：在独立 Supabase 测试项目核对名称/project ref，不能把旧站生产项目当测试环境。禁止为验证方案清空任何已有库。
2. 在 SQL Editor 运行 `supabase/checks/v3-review.sql`（仅 SELECT），保存版本、对象、所有者、RLS/FORCE、触发器、列权限、函数签名/安全属性、PG 目录函数权限。若 foundation 缺失、字段/签名不同、对象混有部分初始化、对象所有者无法 ALTER 或角色无必要权限，停止并提供输出，不能用 DROP/IF NOT EXISTS 掩盖差异。
3. 确认基础表存在后运行 `supabase/checks/v3-data-integrity.sql`，保存旧列/打卡计数和哈希。异常历史日期如非零须人工调查，不静默修正或删除。列不齐的部分初始化先只查 catalog，不硬套升级。
4. **备份前提**：确认 Supabase 套餐可用的备份/PITR、保留期和恢复目标；在独立项目实际验证恢复。没有可恢复备份时不执行。若人工 pg_dump，应覆盖 habit_mobile 及恢复依赖（Auth 用户身份/相关 FK/权限），仅备份业务 schema 不能保证恢复整个项目。年度快照 RPC/图表 JSON 不是完整备份，不含全部操作回执与 Auth 身份。备份含私人记录，应加密受控保存；不要提交数据库密码/连接串或备份到 GitHub。
5. 完全空的新测试项目：仅先执行 `supabase/migrations/202610110001_mobile_cloud.sql`，再执行经批准的 proposal。已正确安装 foundation 的项目：只执行 proposal。**不要执行历史 202610090001/002，也不要对整个 migrations 目录无差别 db push。** 手动 SQL Editor 不一定写 CLI migration history，后续 CLI 纳管需另审记录策略。
6. 全选经审批的 `supabase/proposals/202610190001_v3_expansion.sql`，作为一个事务执行，不逐段挑选。草案有 lock_timeout=5s，不能获取锁时直接失败而不长期卡住。它不需要创建角色、Auth GRANT OPTION、ALTER FUNCTION OWNER 或关闭 RLS。
7. 重新运行两个只读文件。旧列和打卡计数/哈希须相同；立即执行的新字段默认检查应为 0，progress_operations 应为 0；三张表 RLS/FORCE 均 true，视图 security_invoker=true；新旧函数 INVOKER、空 search_path、anon 无执行权。
8. 完成下面 Data API 配置及真实双账号验收。通过后仍须用户另行批准真实项目迁移与阶段 3 开发；本轮不会部署新前端，也不会修改旧站。

## Data API 控制台（用户审批后手动操作）

项目关闭自动暴露新表时，schema USAGE、数据库授权、对象暴露与 RLS 是四层独立条件，不能只勾选一项就声称接口可用。

- 保留已有 `habit_mobile` 为 Exposed Schema；不要暴露 auth 或历史 habit_private。
- 保留原 habits/habit_checkins 和五个旧 RPC 的现有暴露，不改 Auth/Site URL/Redirect URL。
- 新业务 **Functions** 选择：create_habit_v3、edit_habit_v3、archive_habit_v3、record_progress_v3、reorder_habits_v3、read_snapshot_v3、read_summary_v3、read_streaks_v3。每个名字只应有一个签名，避免 PostgREST 重载歧义；SQL 已含 NOTIFY pgrst reload schema，必要时等待控制台 schema cache 刷新。
- 不把 require_user_v3 或 guard_* 当业务 RPC 暴露。require_user_v3 仍必须具有 authenticated EXECUTE 以便 INVOKER 函数内部调用；这不意味着必须给它一个 REST 入口。
- **Tables/Views**：V3 前端方案全走 RPC，不需要公开 progress_operations 的表 REST 端点，也不必公开 habit_daily_progress 视图端点；推荐保持未暴露。内部 SQL 访问依靠已授予的输入列 INSERT/SELECT 和视图 SELECT，不依赖表是否有公开 REST 端点。如为了受控调试手动暴露，RLS/列权限仍必须有效，不能授予表级任意 INSERT/UPDATE/DELETE。
- authenticated 已有 schema USAGE，新 RPC EXECUTE 由 SQL 精确授予；anon 不授表/函数；禁止为了修复 401/403 扩大 PUBLIC 权限。auth.uid() 和事务 advisory lock 目录函数权限必须在只读预检确认；如托管环境策略不同，先停止并审查，不通过 definer/高权限角色绕过。
- 仅前端 Project URL + publishable key，真实 API 请求头指定 habit_mobile schema。禁止 service_role、secret key、数据库密码进入前端或仓库。

## 失败与恢复

- **事务内失败**：SQL ERROR/锁超时应使整个事务回滚；若 SQL Editor 会话停留在 aborted transaction，先手动 ROLLBACK，再只读核验。不要局部重跑剩余段落。草案重复执行会明确失败，不是幂等安装脚本；错误必须说明已完整安装还是部分初始化。
- **提交后尚未有新数据**：先停写并核验备份。只有经审阅的逆向迁移才能恢复旧函数/权限并处理依赖，不能宣称 DROP TABLE/COLUMN 是无损的通用回滚。本交付不提供一键破坏性 down.sql。
- **提交后已有数值记录**：优先保持 schema 并修复前进；可暂回旧 UI 但它仅显示 Boolean。不能删除日志或新列，否则丢失数值历史/幂等回执。PITR/整库恢复会影响之后全部账号写入及 Auth 状态，须制定停写、差异导出、恢复到独立项目与对账方案，经用户明确授权。
- **旧 SQL 部分初始化**：新草案未运行时，habit_api/private 的残留不构成执行旧同步迁移的理由。若 habit_mobile 自身不符合 foundation，先输出 catalog 差异，制定逐对象恢复迁移，不能为通过测试删除已有对象。

## 自动化测试（本地隔离）

`python3 supabase/tests/run-v3.py empty`：新建本地临时 PostgreSQL 容器 → 模拟 Auth/RLS 角色 → 非超级用户安装 foundation → 原有测试 → 草案晚期故障注入/回滚 → 草案安装/重复拒绝 → V3 安全和兼容测试 → 独立会话并发。

`upgrade`：增加旧活跃/归档习惯、2024 闰年历史、迁移前快照；升级后逐列比较原身份/日期/时间/打卡，并验证历史汇总/徽章。另有 54,750 行数值日志体量探针。

两个 runner 只能新建并清理自己标记的本地容器，不接受远程 DB URL。historical fixture 为模拟几年前自然产生的数据而短暂关闭两个本地触发器后立即重启；**从不关闭 RLS**，不是通过绕过被测安全检查制造成功；迁移本身无 DISABLE TRIGGER。安全和并发测试均在触发器恢复后执行。

CI 在现有数据库工作流新增独立 empty/upgrade job；不执行远程 SQL。没有改 Pages 正式/预览部署流程。src 与前端行为完全不改，仍运行现有类型、格式、单元、浏览器和双 Base 构建。

测试用 request.jwt.claim.sub 只是 PostgreSQL 策略输入，不模拟 JWT 签名/GoTrue/PostgREST、真实托管权限、邮件认证或 API 暴露设置。PG17 本地通过不能声称真实 Supabase 验证通过；PG15/16 兼容性由所用语法设计，不等于已运行对应版本。

## 真实云端人工验收（批准后、仅独立测试项目）

1. 用真实 Auth 注册/验证并登录 A、B，获取各自短期会话，由安全测试客户端调用业务 RPC；不要在日志、截图或文档粘贴 access/refresh token。
2. 未带 JWT、无效/过期 JWT 请求受保护对象必须拒绝；这一步不能用 SQL Editor SET ROLE/模拟 claim 代替。
3. A 建 Boolean/Duration/Count 并自选 Emoji；旧客户端仍读 Boolean，V3 读三种模式；刷新/重新登录/另一设备读取相同 Emoji 和顺序。
4. B 尝试 A 的习惯 ID/operation_id、排序列表、数值修正/读取，必须失败或看不到；相同 text habit ID 在 A/B 独立创建互不影响。检查视图与表端点（若暴露）也不能越权。
5. 学习 +45/+105 =150，目标120达标；同操作 ID 重试仍150，换负载同 ID 报错；两个真实会话同时 +5/+15 累计准确；过期 revision 修正必须冲突，实际值不悄悄覆盖。
6. 两设备从同顺序提交不同目标，一笔成功另一笔冲突；归档/新增后旧 expected 列表不能遗漏习惯；失败后整组顺序保持，不出现部分更新。
7. 归档后新数值命令/打卡/取消均拒绝，旧回执重放可读且不新增；归档当天历史仍在。历史日期/未来/负数/超大输入/非法 Unicode 和单位都拒绝，失败后命令和状态不留半笔。
8. 人工断网/响应丢失后，只复用原 operation_id 对账；退出重登后记录从云端恢复，不依赖本地旧数据。重新打开无未验证离线补写。
9. 热力图：创建前、归档后、空账号日期为无数据；闰年、跨周跨年、午夜北京日期正确；量与完成数分开。今天的率注明未结束。
10. 长期历史即使超过一年，最长连续/7/21/30 天达成日期正确；普通断签保留，修正历史依批准规则重算；读取不播放新成就动画。
11. 实测默认/单习惯年度明细与 summary 响应大小/耗时；必要时检查 EXPLAIN、索引及项目限制，不能把本地耗时当网络 SLA。
12. 保留测试结果，用户确认数据库验收通过后才启动阶段 3（Emoji/排序/数值 UI），最后阶段 4（热力图/趋势/徽章 UI）。不自动合并或部署。
