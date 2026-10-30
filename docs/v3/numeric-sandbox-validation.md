# 手机端数值习惯：沙盒审计与验收（2026-10-30）

分支：feat/mobile-insights-heatmap-badges，开发基线7bee12d。唯一获准远程项目为 **habit-tracker-v3-sandbox**。本轮没有访问、迁移任何远程数据库，没有部署站点，没有修改main。

## 迁移审计与当前阻断

`supabase/proposals/202610190001_v3_expansion.sql`与bbcc624版本一致，没有为通过检查修改其安全拦截。

- 必须先有正确的mobile foundation（202610110001_mobile_cloud.sql）；不执行旧001/002同步迁移。
- 草案需PG15+，本轮实际测试PG17.11；security_invoker视图要求PG15+。PG15/16及Supabase托管权限本轮未实测。
- 所有RPC为SECURITY INVOKER、固定空search_path；没有CREATE ROLE、ALTER OWNER、SECURITY DEFINER、Auth权限扩张或RLS绕过。
- 三张业务表RLS/FORCE RLS；用户复合外键、打卡唯一性、操作回执主键和事件版本唯一性保护数据。日志只追加，输入列INSERT也触发同样校验；客户端不能伪造用户、结果版本和确认状态。
- 每用户事务锁串行化；同operation_id同载荷重试返回旧回执，不同载荷拒绝；事件修正CAS、void撤销、日终确认版本集合、批量写入整事务回滚保留。
- 旧Boolean数据不迁移、不重新解释；原五个RPC保持签名和Boolean范围。新版数字历史允许在创建/归档有效区间内修正，未知/纯记录状态不当成功。
- 整事务DDL有锁超时；已安装/部分安装明确拒绝。遇到v3_already_installed_or_partial、missing_runtime_permissions、foundation_rls_required等，必须停止并人工审查，不删除对象、不使用IF NOT EXISTS掩盖差异，也不改客户端权限绕过。

**可信沙盒连接未提供**：当前运行环境没有Supabase工具、Supabase变量或凭证绑定，也没有可核对的沙盒Project URL/ref。因此没有尝试远程SQL，不能描述为“真实Supabase迁移成功”或“Supabase已经拒绝执行”。阻断在身份和访问前置条件层。不能从旧预览配置猜测项目，更不能借用正式项目密钥。

新增只读文件：`supabase/checks/v3-sandbox-preflight.sql`。先在Dashboard确认项目名称及ref，再运行；current_database()=postgres本身不能证明项目身份。该文件仅查询目录，识别foundation缺失、旧命令草案、部分/已安装V3；然后结合原v3-review.sql完整检查函数签名、所有者、触发器及权限。只有原两表存在才能运行v3-data-integrity.sql。

## 根因与修复

| 问题                                               | 修复                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 默认🎯和自由输入Emoji不符合SQL十项白名单           | 默认🌱，使用相同白名单选择器                                                                        |
| 所有错误被笼统归为未升级数据库                     | 区分缺RPC、权限/RLS、会话过期、版本冲突、日期、累计上限和网络超时；不显示Token/密码                 |
| 改日期后旧记录仍能显示为新日期；旧请求可覆盖新响应 | 选择绑定habit+date，请求代次防护、加载时清空旧上下文；读取失败明确“尚未成功读取”，不显示假空日      |
| 历史修改/撤销被前端一律禁止                        | 按服务端允许的有效日期开放，保留原event_id/occurred_at，提交expected_revision；归档习惯历史也可查看 |
| 写失败只刷新今日汇总，过期事件revision仍能继续操作 | 同时重读今日snapshot、所选日明细与统计；失败后暂停写入，用户核对后明确恢复，不自动重发+1            |
| 超过100条只能看到提示                              | 使用服务端UUID游标继续读取，部分加载时明确标注范围                                                  |
| 快速提交可能生成两个独立事件                       | 同步ref锁防重复提交；每个真实新行为有独立event UUID/operation UUID                                  |
| 账号切换后旧组件响应可能污染当前视图               | 按user.id重挂载、卸载后忽略响应；每次RPC固定发起会话的Authorization，避免SDK晚取token时切换账号     |
| 没有实际计时入口                                   | 支持前台秒计时、整分钟保存和手动分钟；不足一分钟不计，失败保留待核对分钟数                          |
| 只有今日累计，没有数值历史汇总                     | 所选日明细与完成率，服务端近7/30天汇总；北京时间展示，不按手机时区重解释                            |

原有普通习惯进度/热力图/徽章仍以Boolean历史计算，数值统计独立展示。数字新增界面本轮只创建at_least；读取已有tracking_only/at_most时明确方向和“尚未结束/超标”，不播放数值目标达成庆祝。没有增加完整限制型日终确认UI或统一全部类型的热力图/徽章。

## 实际自动化验证

- TypeScript、Prettier通过；69项单元测试通过。
- PostgreSQL17.11：empty/upgrade各自新建有标记的本地容器，通过原foundation测试、故障注入回滚、重复安装拒绝、RLS/FORCE、模拟A/B隔离、幂等、实际多连接并发/修正CAS/重复void、旧列/打卡哈希不变、闰年历史、五年连续。
- 新只读预检在缺foundation、只有foundation、V3已安装三种本地状态执行，均返回预期状态。没有更改草案绕过预检。
- 体量探针54750行：年度明细565881字节，摘要44680字节；两次本地RPC连同Docker开销418.1ms，不是托管网络SLA。
- Playwright正式/预览两个base完整回归：66 passed、2原有路径不适用skip；新增10项为390×844、触控、手机模式、洛杉矶时区，检查北京时间明细、同日多笔、编辑撤销、恢复、冲突、响应丢失、失败不假空、分页、计时和快速重复提交。
- 首次数值测试暴露UUID排序随机导致“第一笔”并非固定数值，改为明确选择目标数值的事件；未减少断言。首轮全量出现6处旧选择器重复匹配（统计文字/多status），限定到对应统计区域与原保存提示后完整通过。
- 原分支insights.ts、insights.test.ts、styles.css存在Prettier失败，仅格式化；未改其统计逻辑或样式值。
- 正式/预览生产构建通过；本地使用合成公开配置，**不是已绑定沙盒的功能验收包**。没有发布网站。

以上数据库测试的request.jwt.claim.sub是本地策略输入，不是Supabase JWT验签；浏览器使用真实SDK加模拟API，不能证明真实Auth/PostgREST/RLS配置已通过。没有执行真实沙盒JWT、跨账号API或iPhone Safari/PWA实机验收。

## 沙盒下一步人工步骤

1. 确认Dashboard项目名habit-tracker-v3-sandbox及Project URL/ref，在环境设置安全配置沙盒连接方式；聊天中只需公开URL，不发送数据库密码、secret/service_role key。前端仅使用该沙盒URL和publishable key，绝不能复用指向正式项目的旧Repository variables。
2. 在该项目运行新增只读预检和v3-review.sql，保存对象/签名/权限结果；缺失、部分安装、所有者或Auth依赖不符则停止。已有V3时比对目录，不重复运行proposal。禁止删除旧对象或重建已有库。
3. 确认可恢复备份/旧数据计数哈希。全新获准沙盒先执行mobile foundation；仅有正确foundation时再整体执行proposal事务。不要按旧001/002路径安装，不逐段忽略错误。
4. 迁移后核验旧列/打卡哈希、三表RLS/FORCE、调用者权限视图、匿名无EXECUTE及输入列授权。任何失败立即停止，事务异常先人工ROLLBACK并只读核验，按migration-review.md备份恢复方案处理，不DROP新数据表。
5. Data API只在该沙盒开放habit_mobile及所需业务函数（见api-and-statistics.md）；不开放内部helper/guard，不扩大日志写权限，不关闭RLS。核对沙盒Auth预览回调，前端配置只允许publishable key。
6. 真实账号A/B经Supabase Auth各自登录。匿名/无效/过期JWT必须失败；B不能读取或修改A的习惯/事件/排序/版本。SQL Editor模拟claim不能代替此验收，测试日志不得保存access/refresh token。
7. A创建计次目标5，两笔2+3应有两个独立事件；改指定2为4后合计7；撤销该4后合计3。重登及另一手机读取一致；计时输入60+60/秒计时至少61秒保存1分钟，按实际记录查看。
8. 使用沙盒已有历史记录测试跨日期修改和撤销；若全新习惯没有过去日期记录，等待北京次日再验证，不能关闭触发器伪造真实验收。手机非北京时间下明细仍显示北京时刻。核对7/30天分母、无计划日、归档、缺数据和tracking状态。
9. 两个真实会话同时新增不同事件应正确累计；同事件旧revision应冲突；同operation_id相同载荷重试不能重复写，重复void不能重复扣减。断网/响应丢失后不自动重发，先重新核对事件和汇总再继续。
10. 单独在iPhone Safari/PWA测试触控、刷新恢复、退出/换账号、日期切换和前台计时。前台计时未持久化，关闭页面/退出会丢失计时状态；跨北京午夜自动拆分尚未实现，界面明确阻止整段写入错误日期，需人工分日处理。不声称离线计时/离线打卡同步已实现。

## 预览部署结论

代码和构建检查就绪，但**真实云端预览验收条件尚未满足**：需先核实唯一沙盒身份、迁移状态、Data API、真实双账号及独立沙盒公开配置。当前dist-preview仅合成配置构建验证，不能直接上传作为真实云端测试站点。未改现有GitHub变量、正式或预览部署。满足上述条件后才能安排独立预览；main和正式网站保持不变。
