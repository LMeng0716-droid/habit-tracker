# main 代码审查

审查基线：远端 main `5ce4322`（2026-10-09）。在干净工作区 fetch 后从 origin/main 创建 `docs/supabase-sync-design`；未在 main 工作。未发现 AGENTS.md。不是依据上一任务的分支推断 main 状态。

| 文件                                                | 实际行为                                                                                                    | 云同步影响                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| src/domain.ts                                       | schemaVersion 1/2 输入，NormalizedSnapshot v2 输出；分类、scheduleHistory、日期、统计、备注和排序均为纯逻辑 | 可复用转换与统计，但需服务器独立校验                                 |
| src/storage.ts                                      | 优先 daily-progress:v2；不存在时读取 v1，首次保存保留 v1；expectedRaw 与 revision 防同标签/窗口陈旧覆盖     | revision 是整个快照随机值，不能当跨设备实体版本；localStorage 无事务 |
| src/App.tsx                                         | commit 统一保存；storage 事件进入冲突只读；JSON 导入预览计数、明确确认后整体替换；导出原始或 v2 数据        | 云端不能复用整体替换；需要 Repository 接口与导入合并预览             |
| src/domain.test.ts、phase1.test.ts、storage.test.ts | 41 项测试覆盖日期、统计、计划、迁移、失败和保护                                                             | 没有认证、RLS、离线队列、网络冲突测试                                |
| tests/app.spec.ts                                   | 14 项 Chromium 流程覆盖备份、分类、排序、备注和迁移                                                         | 没有真实 iPhone 或双账号云隔离测试                                   |
| vite.config.ts                                      | base=/habit-tracker/，哈希路由                                                                              | Auth 回调不得与业务 hash 路由抢处理                                  |
| .github/workflows                                   | check 全量检查；deploy 仅 main                                                                              | 本次不改部署，不引入密钥                                             |

背景基本一致，但 package.json 仍为 1.0.0，README 仍保留 V1 限制和“阶段 1 待 PR 审核”文字；实际 main 已有 V1.1。此处报告差异，不作无关重写。

## 不能直接复制到数据库的部分

1. newId() 是 32 位十六进制字符串，不是标准 UUID 字符串；预设分类为 preset-N，迁移计划为 initial:<habitId>；打卡和备注 ID 是 JSON 编码的日期组合。原设计文档“分类 UUID”不准确。数据库采用 opaque text，不能强制 UUID 转换或批量换 ID。
2. 没有 userId、实体版本、服务端时间、墓碑、操作 ID、同步游标；删除习惯/分类/打卡或清空快照会直接移除数据，远端离线设备因此可能复活旧数据。
3. 每项习惯 order 为整数，重排会改多个习惯。云端使用独立、单版本的全局排序行，避免并发半排序。
4. scheduleHistory 需要独立表；过去生效计划不可修改，编辑下一周尚未生效版本。跨设备日期应以账号日历时区为准，新时区不重新解释旧日期。有效日期不能用 UTC 时间戳替代。
5. archiveHabit 明确移除归档当天记录；云端必须原子地产生撤销事件。备注独立保留，noteEligible 允许归档当天备注，与打卡的排他截止不同。
6. parseSnapshot 最大 5 MiB，拒绝未来日期与远于下周一的计划，丢弃未知字段。不能用它解析包含云版本、冲突候选、墓碑的同步缓存。迁移 ID 无长度上限，而 SQL 有有限长度：预检必须报告超限，不截断 ID、不丢记录。createdAt 是毫秒数，SQL bigint 迁移需预检整数及安全范围；不符合则停止该数据集并让用户修复备份副本。
7. 导入是显式整体替换本地快照。云模式必须使用新的“备份恢复/合并”流程，不能映射为 truncate、delete all 或 upsert all。

## 兼容方案

原 v1/v2 键只读保留；新缓存放 IndexedDB，按 Supabase project ref + auth user ID 命名，禁止匿名/账号 A 缓存当作账号 B 数据。纯 domain 对外仍可返回去墓碑后的 NormalizedSnapshot；云元数据保留在 Repository 和同步层，不在 parseSnapshot 中悄悄混入。

v1/v2 导出继续产生可离线恢复的兼容备份；另设计独立 cloudBackupVersion=1 包含模型版本、服务器版本与来源，但导入永远不信任备份里的 user_id/权限/版本。SQL表没有重复保存组合记录 ID；导出时由 habitId/date 确定性重建，原字符串 ID 与关联始终保留。
