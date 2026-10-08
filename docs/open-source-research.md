# 「每日进步」GitHub 开源项目调研

调研日期：2026-10-08（北京时间）。目标：为初学者维护的中文习惯打卡网页应用选择第一版方案；本次不开发、安装应用依赖或部署。

## 1. 结论

推荐独立实现 **React + TypeScript + Vite + 原生 CSS + localStorage** 的小型单页应用，学习 nicopanozo 的组件拆分、DoHabit 的本地优先流程和真实日期建模、Loop 的低干扰交互。不要直接复制任一完整仓库：两个指定项目缺少项目级 LICENSE，DoHabit 使用 AGPL-3.0；CSI-CATT 的核心逻辑还未完成。第一版不需要后端、账户或云同步。

补充核实了 Loop 与 Habitica 两个成熟项目。它们质量和产品深度有参考价值，但均不满足“初学者容易维护的网页底座”条件，因此作为对照而非推荐模板。受搜索/API访问限制，本次未找到并验证两个以上额外的轻量网页候选；不以未经验证的名单凑数。

## 2. 方法、证据与限制

通过平台 HTTPS Git 通道读取三项指定仓库的默认 HEAD、README、依赖清单、应用源码、许可证和最近提交；补充仓库采用浅层历史读取。没有执行这些应用、安装依赖或访问线上演示，所以运行可靠性、实际浏览器交互、无障碍合规和离线能力均 **未验证**。界面评价来自源码和已查看的仓库截图，截图可能滞后于代码。

GitHub API `https://api.github.com/repos/{owner}/{repo}` 请求收到代理 `403 Forbidden`。Git 通道可用不代表 API 可用。星标数量、归档标记、Issue响应、最新正式Release、安全公告和默认分支之外的维护活动均 **未验证**；最近提交日期不等于最近发布日期，也不证明持续维护或代码质量。

以下链接对应实际通过 Git 读取过的文件/提交对象，而非声称已浏览这些 HTML 页面。采用完整提交 SHA 固定证据，后续评估应重新检查最新版本。

| 项目 | 核实 HEAD | 最近提交时间（提交自带时区） | 初步维护判断 |
| --- | --- | --- | --- |
| nicopanozo/react-habit-tracker | `601017841c2b46988db7bdf965c80ea1ba2bedb7` | 2025-07-02，-04:00 | 超过一年未见该 HEAD 后提交；最近五条多为部署相关 |
| iNikAnn/DoHabit | `a9a2db0ffddb4867f8857097a0582ab5e3d2f999` | 2026-09-30，+08:00 | 近期有路由修复、日期与存储测试提交 |
| CSI-CATT/Habit-Tracker | `727e509d74b92e0992a5e66dfa821c099e2b1df7` | 2025-10-12，+05:30 | 近一年无该 HEAD 后提交；源码有未完成部分 |
| iSoron/uhabits（Loop） | `7e993e17b2b674d4b5b1291ebd18677b74810df2` | 2026-07-21，-05:00 | 有近期 Android UI 修复；仅检查最近30条浅层历史 |
| HabitRPG/habitica | `0989bbeae08596eaa4494bd456f793af26d31329` | 2026-10-05，-05:00 | 有近期版本提交；README 明示自2026-08-04暂停公开代码PR接收；仅检查最近10条历史 |

最初尝试的 `open-nomie/nomie6`、`LoopHabitTracker/uhabits`、`habitica/habitica` 路径返回 Repository not found；这些路径 **未验证**，不能据此断言项目不存在。后两者分别改用已成功读取的 iSoron/uhabits、HabitRPG/habitica。

## 3. 核心功能与用户交互对比

| 维度 | react-habit-tracker | DoHabit | CSI-CATT/Habit-Tracker | Loop（补充） | Habitica（补充） |
| --- | --- | --- | --- | --- | --- |
| 核心路径 | 新建名称/颜色 → 星期勾选 → 查看周进度；编辑、删除、搜索、筛选、排序 | 新建习惯 → 每日累计进度 → 完成；历史、日记、统计、归档、备份、成就 | 表单选择名称和频率 → 列表打卡/删除；新增逻辑为空 | 习惯列表 → 记录完成 → 详情历史/趋势；支持提醒和桌面小组件 | 习惯/每日任务/待办 → 完成得经验和金币，失败扣生命；RPG奖励 |
| 视觉结构 | 浅色卡片、色条、进度条、7个星期复选框；有深色主题和响应式样式 | 深色移动卡片、图标、彩色日历、圆形进度、抽屉/弹窗；已有中文语言文件 | MUI表单、白色Paper卡片、绿色完成按钮、线性进度条；界面细节粗糙 | 紧凑列表、日期格、详情分卡片、夜间模式；Android原生界面 | RPG主题；实际界面截图未检查，仅根据 README 和任务逻辑描述 |
| 日历与历史 | 仅周一至周日布尔值；**不是按真实日期保存的周/月历** | 真实日期列表；主日历展示当月与上月，另有紧凑日历和年份统计 | 日期字符串列表有打卡逻辑；未发现应用级日历界面 | 历史日历、频率图与统计卡；支持复杂周期 | 任务历史存在；独立月历是否满足本需求 **未验证** |
| 连续打卡 | 算星期数组中的最长连续段；不代表截至今天的连续天数，不能跨周 | 当前与最长连续、连续段历史；当前判断接受最后完成为今天或昨天；依赖倒序日期输入 | 从今天往前查日期；今天未完成直接为0，且采用UTC日期截取 | Streak与Score是不同模型；评分允许偶尔中断，不把总进步清零 | 每日任务连续数参与奖励，普通习惯与每日任务规则不同 |
| 统计 | 周完成数量和百分比；高级统计列为未来计划 | 按年查看、星期柱图、月份趋势、总完成数、连续历史 | `streak / 30`进度条，并非月完成率；未见完整统计页 | 得分、历史、连续段、频率；支持数据导出 | 游戏数值与任务评分复杂；通用完成率图表 **未验证** |
| 数据 | localStorage，无服务器 | IndexedDB（idb-keyval）+ Zustand持久化与迁移；设置等另有localStorage工具 | 导入persist却未应用到store；刷新持久化未实现 | 本地模型；README说明可导出CSV/SQLite | Express/Mongoose后端和账户数据；需要服务运维 |

### react-habit-tracker：最容易阅读的UI参考，不能照搬日期模型

优点：组件职责清楚，依赖少，表单/列表/卡片/进度条便于初学者学习；查看截图确认有清晰留白和颜色区分。适合借鉴“一张卡片完成主要操作”，但首页搜索、排序和筛选对仅有几个习惯的第一版偏重。

关键问题：`Habit.completedDays` 使用 `monday…sunday` 键，`calculateStreak` 返回这一固定数组的最长片段。例如周一至周三完成、周五完成，也可能显示最长3天，而不是当前连续1天。没有跨周日期身份与历史；“完成”筛选意味着七天全完成，而非今天已完成。README 的月/年视图、导入导出和高级统计属于未来增强，不应计入现有功能。

README 声称 MIT，但读取整个受跟踪文件清单未发现项目 LICENSE/COPYING/NOTICE。**许可证声明与授权文本不完整**，本次不能把它认定为许可证已核实的 MIT 代码来源。无障碍/WCAG声明也没有经过运行验证。

### DoHabit：产品方向最贴近，但维护面更大

源码核实 React19、TypeScript6、Vite8、Zustand、idb-keyval、Chart.js、Framer Motion、React Router、i18next 和 PWA 插件。层次为 app/entities/features/pages/shared/widgets，约数百个文件；有日期、存储、路由等测试，build脚本包含类型检查和测试，但本次 **未运行**。

值得学习：免注册、本地数据、日期独立记录、按需进入统计、归档而非一概删除、数据迁移和备份入口。频率表单实际是每天1～12次，不能误读成每周几次。已有zh.json，但中文覆盖和翻译质量 **未验证**。

代价：动画、成就、日记、多语言、PWA生命周期、异步存储迁移及多页路由一起维护，超出第一版所需；仓库还包含捐赠支付API和数据库schema，习惯主流程本地存储不等于整个仓库没有后端。截图显示紧凑日历在手机上信息密集，不建议第一版把两个月日历放进每张卡片。

LICENSE 为 AGPL-3.0。复制或改造代码要评估整个衍生作品的许可证兼容性；分发及修改版本的网络交互可能带来相应源代码提供义务。不能直接抽几段组件就当成无限制可用代码。

### CSI-CATT/Habit-Tracker：只能作为未完成的教学样例

React19 + TypeScript5.8 + Vite7 + Zustand5 + MUI7/Emotion + Tailwind4。应用源码少，但双样式体系和被提交的 node_modules 增加仓库体积与维护噪声；本次只读取，没有安装或执行这些受跟踪依赖。

已确认源码缺口：`addHabit` 仍是空函数；`HabitStates` 被引用/导入，却未在store文件定义/导出；persist/devtools只导入未使用。表单频率标签仍是“Age”，weekly/monthly选项没有对应目标计算规则。连续逻辑使用 `toISOString().split('T')[0]`，在北京时间凌晨可能得到前一天。以上是静态源码发现，不宣称已实际构建失败。

未找到项目级LICENSE，node_modules中第三方包的LICENSE不能授权该项目作者代码。暂不推荐作为起步仓库。

### Loop：适合借鉴行为设计，不适合作为Web代码底座

Android原生项目，Kotlin/Java生态、Gradle Kotlin DSL，拆分 uhabits-core 与 uhabits-android；读取的核心文件清单包含Streak/Score/Frequency模型和相关测试。README说明提醒、小组件、CSV/SQLite导出、离线免账户和复杂频率；真实安装体验 **未验证**。

借鉴“今天记录优先，历史和统计放详情”，以及中断后仍保留累计成果。不要复制其复杂习惯得分公式到第一版，否则用户难以解释结果，也增加测试负担。GPL文本+README授权版本3或之后版本；复制和分发衍生代码须遵守GPL义务；NOTICE中的依赖/素材还各有许可证。

### Habitica：用于界定第一版不做什么

读取 README、根/客户端package.json、LICENSE、scoreTask和cron：Vue2.7 + Vite客户端、Node/Express + MongoDB/Mongoose服务端，并有Redis相关依赖、支付与认证生态。功能逻辑将每日任务连续记录和奖励、生命值、成就关联，和轻量二元打卡目标不同。

维护活跃不等于易维护，或欢迎外部PR；README同时保留旧贡献文案但顶部明确暂停公开代码PR，另有禁止AI生成代码投稿政策。本次只研究，不向该项目投稿。代码GPLv3；BrowserQuest素材CC-BY-SA3.0；HabitRPG素材CC-BY-NC-SA3.0（含非商业限制），不能把代码许可扩大到品牌和全部美术。

## 4. 复杂度、维护成本与选型

| 项目/方案 | 相对复杂度 | 主要维护成本 | 用于第一版 |
| --- | --- | --- | --- |
| nicopanozo | 低 | 真实日期重建、备份、存储错误处理、许可证澄清 | 借鉴结构与信息层级；独立实现 |
| DoHabit | 中高 | 多实体状态、异步迁移、PWA缓存、动画、统计和多语言 | 产品参考；不建议整仓fork |
| CSI-CATT | 表面低，补全成本高 | 未完成核心逻辑、类型缺口、依赖入库、双CSS体系 | 不选为底座 |
| Loop | 高（对Web初学者） | Android工具链、系统通知、小组件、复杂频率 | 只借鉴设计 |
| Habitica | 很高 | 多服务、账户、支付、游戏规则、旧客户端生态 | 不选；作为范围控制反例 |
| 独立轻量Web | 低到中 | 日期规则、可靠存储与恢复、中文交互 | **推荐** |

“低维护”不意味着不要测试。第一版最需要验证的是日期、连续算法、刷新保留和导入失败不破坏原数据，而不是大图表或复杂动画。

## 5. 设计借鉴与代码复用边界

- 可学习一般产品方法：卡片布局、减少注册步骤、月历反馈、当前/最长连续分开、备份入口。由需求重新画布局、写文案和实现逻辑；不要照抄独特插画、品牌、截图或整套视觉表达。
- 缺少项目级授权文本的两个仓库：默认不复制代码/素材，先要求权利人补充或提供明确授权。GitHub公开可读不等于可任意复用。
- AGPL/GPL项目并非不能商业使用，但代码复用有具体开源/源代码提供义务，不适合在尚未决定本项目发布许可证时直接混入。
- 每次实际复用记录来源提交、文件、许可证、修改和NOTICE；单独审查依赖、字体、图标和图片。普通依赖通过官方包引入也需核对锁定版本许可证，不能由仓库总体许可推断。
- 本次仅编写原创中文分析和方案，没有复制应用代码、素材或许可证作为本项目授权。上述为选型判断，不替代具体发布前的许可证审核。

## 6. 已读取来源索引

### 指定项目

- [nicopanozo：README](https://github.com/nicopanozo/react-habit-tracker/blob/601017841c2b46988db7bdf965c80ea1ba2bedb7/README.md)、[依赖](https://github.com/nicopanozo/react-habit-tracker/blob/601017841c2b46988db7bdf965c80ea1ba2bedb7/package.json)、[日期与连续工具](https://github.com/nicopanozo/react-habit-tracker/blob/601017841c2b46988db7bdf965c80ea1ba2bedb7/src/utils/habitUtils.ts)、[数据类型](https://github.com/nicopanozo/react-habit-tracker/blob/601017841c2b46988db7bdf965c80ea1ba2bedb7/src/types/Habit.ts)、[主应用](https://github.com/nicopanozo/react-habit-tracker/blob/601017841c2b46988db7bdf965c80ea1ba2bedb7/src/App.tsx)、[已查看截图](https://github.com/nicopanozo/react-habit-tracker/blob/601017841c2b46988db7bdf965c80ea1ba2bedb7/public/screenshots/image.png)、[最近提交](https://github.com/nicopanozo/react-habit-tracker/commit/601017841c2b46988db7bdf965c80ea1ba2bedb7)。
- [DoHabit：README](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/README.md)、[LICENSE](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/LICENSE)、[依赖](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/package.json)、[数据类型](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/src/entities/habit/model/types.ts)、[连续计算](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/src/entities/habit/lib/getStreaks.ts)、[持久化](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/src/entities/habit/model/store.ts)、[日历](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/src/shared/ui/calendar/main/Calendar.tsx)、[统计页](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/src/pages/habit-statistics/ui/HabitStatisticsPage.tsx)、[每天次数表单](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/src/widgets/habit-form/ui/frequency-field/HabitFrequencyField.tsx)、[已查看截图](https://github.com/iNikAnn/DoHabit/blob/a9a2db0ffddb4867f8857097a0582ab5e3d2f999/public/assets/img/welcome-hero-screenshot.webp)、[最近提交](https://github.com/iNikAnn/DoHabit/commit/a9a2db0ffddb4867f8857097a0582ab5e3d2f999)。
- [CSI-CATT：README](https://github.com/CSI-CATT/Habit-Tracker/blob/727e509d74b92e0992a5e66dfa821c099e2b1df7/README.md)、[依赖](https://github.com/CSI-CATT/Habit-Tracker/blob/727e509d74b92e0992a5e66dfa821c099e2b1df7/package.json)、[未完成store](https://github.com/CSI-CATT/Habit-Tracker/blob/727e509d74b92e0992a5e66dfa821c099e2b1df7/src/store/store.ts)、[列表/连续逻辑](https://github.com/CSI-CATT/Habit-Tracker/blob/727e509d74b92e0992a5e66dfa821c099e2b1df7/src/Components/HabitList.tsx)、[表单](https://github.com/CSI-CATT/Habit-Tracker/blob/727e509d74b92e0992a5e66dfa821c099e2b1df7/src/Components/HabitForm.tsx)、[主应用](https://github.com/CSI-CATT/Habit-Tracker/blob/727e509d74b92e0992a5e66dfa821c099e2b1df7/src/App.tsx)、[最近提交](https://github.com/CSI-CATT/Habit-Tracker/commit/727e509d74b92e0992a5e66dfa821c099e2b1df7)。

### 补充项目

- [Loop：README](https://github.com/iSoron/uhabits/blob/7e993e17b2b674d4b5b1291ebd18677b74810df2/README.md)、[LICENSE](https://github.com/iSoron/uhabits/blob/7e993e17b2b674d4b5b1291ebd18677b74810df2/LICENSE.txt)、[NOTICE](https://github.com/iSoron/uhabits/blob/7e993e17b2b674d4b5b1291ebd18677b74810df2/NOTICE.md)、[Gradle构建](https://github.com/iSoron/uhabits/blob/7e993e17b2b674d4b5b1291ebd18677b74810df2/build.gradle.kts)、[模块配置](https://github.com/iSoron/uhabits/blob/7e993e17b2b674d4b5b1291ebd18677b74810df2/settings.gradle.kts)、[最近提交](https://github.com/iSoron/uhabits/commit/7e993e17b2b674d4b5b1291ebd18677b74810df2)。核心模型仅核实文件清单，不宣称审计全部算法。
- [Habitica：README](https://github.com/HabitRPG/habitica/blob/0989bbeae08596eaa4494bd456f793af26d31329/README.md)、[LICENSE](https://github.com/HabitRPG/habitica/blob/0989bbeae08596eaa4494bd456f793af26d31329/LICENSE)、[服务端依赖](https://github.com/HabitRPG/habitica/blob/0989bbeae08596eaa4494bd456f793af26d31329/package.json)、[客户端依赖](https://github.com/HabitRPG/habitica/blob/0989bbeae08596eaa4494bd456f793af26d31329/website/client/package.json)、[任务评分](https://github.com/HabitRPG/habitica/blob/0989bbeae08596eaa4494bd456f793af26d31329/website/common/script/ops/scoreTask.js)、[日结逻辑](https://github.com/HabitRPG/habitica/blob/0989bbeae08596eaa4494bd456f793af26d31329/website/common/script/cron.js)、[最近提交](https://github.com/HabitRPG/habitica/commit/0989bbeae08596eaa4494bd456f793af26d31329)。
