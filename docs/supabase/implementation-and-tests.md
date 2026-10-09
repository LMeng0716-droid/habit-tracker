# 分阶段实施与验收清单

## PR 阶段和门槛

| 阶段                    | 交付                                                                         | 合并/接入门槛                                                                |
| ----------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 本次：设计与基础迁移    | 代码审查、关系表/RLS、只读权限、冲突协议及测试脚本                           | 人工审核设计；不会自动应用SQL或发布                                          |
| A：测试项目数据库写协议 | bootstrap、带版本CAS的原子RPC、staging导入、事件分页、receipt、业务校验      | 本地和隔离Supabase RLS/API/并发测试全部通过，才开放EXECUTE；持续禁止直接表写 |
| B：账号与缓存抽象       | supabase-js最小接入、Auth回调、Repository、IndexedDB与outbox，默认云开关关闭 | 本地功能不回归；邮件验证/重置/退出/账号隔离通过                              |
| C：安全首次导入         | 备份、预检、diff、冲突决策、stage/commit、失败恢复                           | 原v1/v2字节不变；任何中途故障不丢数据、不产生半导入                          |
| D：同步与冲突UI         | 拉/推协议、重试、恢复、双设备冲突、显式状态                                  | 双账号越权测试和电脑/iPhone人工验收通过                                      |
| E：生产配置与分批启用   | 用户审核迁移、控制台配置、Pages公开变量、回滚方案                            | 每一步另行明确授权；备份数据库；禁自动合并/直接发布                          |

每阶段独立分支/PR，CI用隔离fixture，不包含真实数据库密码/服务端key；服务端SQL迁移测试权限放在隔离测试基础设施，不能作为前端配置。数据库回滚优先向前修复/禁用云功能，禁止DROP表回滚。原本地键保留；启用后新增云数据回滚前必须导出，不能把旧副本当最新数据。

## 已执行验证

2026-10-09，在本环境：

- main 现有单元测试 41项通过；type-check与生产build通过。
- PostgreSQL 16独立Docker容器：Auth最小stub、基础migration执行成功。
- SQL断言通过：全部11表ENABLE/FORCE RLS；A/B读取8个业务表只见本人；匿名、无UID与私有schema访问；跨用户UPDATE零行、修改owner及伪造INSERT拒绝；同账号合法UPDATE作为对照；生产INSERT/UPDATE/DELETE无grant；NULL总体总结去重、无周目标CHECK、跨用户分类FK拒绝。
- SQL测试临时写grant和fixture全部ROLLBACK，最终权限边界检查通过。可复现命令：`bash supabase/tests/run-local.sh`（需要Docker；固定已验证镜像digest，创建新容器、不映射端口，退出清理）。
- 这些本地测试不验证真实JWT签名/GoTrue、PostgREST schema暴露、Supabase服务端函数角色、邮件或真实iPhone。没有连接任何远端数据库，也没有运行尚未实现的同步前端测试。

本次不改应用源码/依赖，因此不重复无关浏览器套件；此前浏览器结果仅作背景，不作为本次云同步验收。正式CI与控制台结果待PR创建后观察，不能把本地通过说成生产通过。

## 后续自动化矩阵

- RLS/Data API：真实隔离项目注册A/B，使用publishable key+各自JWT。GET带其他user_id返回空；PATCH他人ID零更新；INSERT伪造user_id失败；owner reassignment失败；跨账号引用失败。匿名/token过期/token伪造皆拒绝。没有service_role参与这些请求。
- 防旁路：直接表INSERT/UPDATE/DELETE拒绝；私有schema不暴露/无usage；未登录RPC拒绝；传入owner忽略/拒绝；RPC不得泄露B数据/冲突payload。缺schema暴露、缺grant、无匹配RLS分别测试，不能通过关RLS解决。
- RPC业务：首次/后续计划日期、历史不可变、weekday_mask、weekly_target、未来日期、归档边界、长ID/文字、未知引用、排序重复/缺失/外国ID、墓碑不能复活；category删除保留习惯，archive打卡与备注边界。
- CAS并发：两事务同版本仅一成功；相同operation_id同hash重复返回同receipt；同ID不同hash拒绝；事务中途故障完整回滚；每用户提交序列并发不漏事件，跨页更新/插入/删除仍正确。
- 迁移：v1/v2、大样本、同名不同ID、同ID不同内容、两个设备同一来源、重映射嵌套引用、云墓碑、预览后云变化、网络断于commit前/后、分块断点、取消与权限撤销；原localStorage字节不变。
- IndexedDB事务：写缓存成功但outbox失败时全部回滚；ACK更新失败保留可重试队列；quota/隐私模式只读；project/user切换无泄漏；登出后同账号恢复队列，不能发到B账号。
- UI/网络：Auth code先于hash处理，邮件验证/重置失败和过期、回调缺verifier、同浏览器与跨浏览器、429/5xx/401/403、iOS后台/重新focus、有效离线与首次离线区别。
- 备份：兼容v1/v2导出恢复，cloudBackup元数据不取得权限，不把删除/冲突记录静默丢掉。CSP/日志扫描不含密码/token/service_role。

## 人工验收（隔离项目，电脑 + 真实 iPhone Safari）

1. 核对Email验证、精确回调、publishable配置、habit_api暴露与读权限；A/B各注册登录，单独验证邮件和重置密码。
2. A电脑先导出v1/v2原文、预览导入；iPhone同账号看到一致分类、计划历史、打卡、备注和顺序，A/B两个账号完全隔离。
3. 两端断网编辑同一/不同字段、相反完成状态、同日备注、下周计划与排序；复网无静默覆盖，冲突候选可保存/导出并选择。
4. 云端已删除的习惯遇到手机离线编辑不能复活；归档取消当天记录仍保留备注；星期/跨年/旅行时区不移历史日期。
5. 导入中断、登录过期、退出切B后检查缓存与队列隔离；重试同batch不重复。检查原localStorage仍逐字一致。
6. 长备注输入、邮件跳回Safari、弹窗和移动排序可用；后台后回前台通过focus同步而非依赖后台计时器。
7. 只有上述门槛通过、用户批准数据库动作和网站发布后才准备生产上线；当前PR不执行这些动作。
