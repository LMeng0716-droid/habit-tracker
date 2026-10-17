# 两表手机端云存储验证记录（2026-10-11）

本次未连接Supabase，未执行任何远程SQL、生产配置、网站部署或合并。

|检查|实际结果|边界|
|---|---|---|
|`npm test`|7个测试通过|新日期/统计/云端模型，旧本地功能测试已被替换|
|`npm run type-check`|通过|前端TypeScript|
|`npm run format:check`|通过|项目脚本覆盖的TS/CSS/JSON/HTML|
|`npm run build`|通过|无配置时的设置提示构建|
|带测试公开配置的生产build|通过|使用habit-build.invalid和显式fixture，未配置真实项目|
|手机尺寸Chromium浏览器|8/8通过|网络API模拟，使用真实supabase-js SDK，不是实际JWT认证或iPhone|
|临时PostgreSQL17.11|安全/业务/事务断言通过|Auth身份是stub，迁移由非超级用户且无Auth GRANT OPTION管理员执行|
|真实重叠数据库会话|4组通过|重复完成、重复取消、完成后归档、归档后完成|
|旧schema保留、重复安装拒绝|通过|旧schema有sentinel记录；未删除或改动；重复CREATE拒绝后计数不变|
|只读检查SQL|在本地安装前后执行通过|不证明远程项目结构或权限已符合要求|
|shell语法、git diff空白检查|通过|本地脚本|

数据库断言包括匿名/空UID拒绝，A/B独立习惯及打卡读取/写入隔离，相同ID分用户隔离，唯一性与重复提交，创建前/未来日期拒绝，客户端不能改owner/创建日期或删除习惯，打卡异常事务回滚，归档保留当天历史/归档后不可操作，所有函数SECURITY INVOKER和固定search_path，全表FORCE RLS。

浏览器断言包括登录/退出、错误密码、创建/编辑、打卡/取消、历史补打、统计、归档只读、刷新及清除浏览器后重新登录恢复、旧业务localStorage不读取、读取失败不是空账号、保存失败保留输入及刷新后重试、换账号拒绝延迟的旧数据、注册/重置邮件提示和密码恢复回调、390px布局无横向溢出。

新数据库没有版本冲突、增量事件、游标、迁移导入或离线队列。原数据库脚本和审计文档保留为历史，但新的CI只执行新方案测试。没有继续声明旧41单元测试/14浏览器测试代表当前产品回归通过。

尚未验证：habit-tracker-test实际结构、托管角色及Auth函数权限、PostgREST schema暴露/权限映射、真实JWT签名/过期/伪造拒绝、真实Email/SMTP/GoTrue回调、真实跨手机恢复、iPhone Safari触控/安全区域、多年大量历史响应容量、GitHub远端CI。

人工步骤和失败恢复见 [implementation.md](implementation.md)。真实测试项目验证完成前不可称已上线或已在Supabase正常运行。

## 2026-10-16 权限专项复核

最新授权与测试说明见 [permissions-review.md](permissions-review.md)。本轮补充empty/legacy两种本地安装状态、整份迁移晚期/早期异常回滚、明确的列权限断言和跨用户归档拒绝。两种状态安装及各4组并发均通过。INSERT列授权与DELETE授权分开，旧组合语法在PG17实际也可执行，未复现其语法错误。前端未修改，本轮仅重跑7个单元测试、类型检查和构建，未重跑浏览器。

## 2026-10-17 公开配置校验

- 39个单元/构建入口测试通过：包含原7个业务测试，以及缺失配置、非法/占位URL、publishable格式、secret/service_role/anon JWT拒绝、额外VITE变量拒绝、dotenv优先级、CLI与直接vite build保护、诊断不回显值、未配置前端提示。
- 8个手机尺寸Chromium回归通过，仍为模拟API，不是真实Supabase；测试合成URL/key按新格式规则更新，请求全被拦截。
- TypeScript、format:check、git diff空白检查通过；初次类型检查发现Node测试类型缺失，补充@types/node及测试文件类型引用后重跑通过。
- 合成公开配置的生产构建通过；缺少配置的实际npm run build以exit=1失败，属于预期拒绝。密钥拒绝/不产生dist及不回显通过隔离临时目录的自动测试验证。
- Pages base仍为/habit-tracker/；只允许main部署的规则保留。未执行远端Actions或部署，未设置仓库变量。
- 没有修改或重跑数据库迁移/数据库测试，没有连接真实Supabase。真实注册/邮件/JWT/RLS/跨手机恢复及iPhone验收仍待完成，步骤见config-and-acceptance.md。

## 2026-10-17 独立预览第一阶段

- 41个单元测试通过；TypeScript、格式与差异检查通过。
- 正式和预览路径浏览器套件共18通过、2跳过。跳过项分别是另一base的专属存储断言（不适用），非失败未修复。使用Chromium触控模拟和模拟Supabase API，不是真实邮箱/JWT/iPhone。
- 新增相同origin下预览Auth与正式Auth/旧daily-progress键的隔离验证；正式路径默认SDK存储键保持不变。注册和重置请求redirect_to在两个base分别匹配当前入口，恢复回调均通过。
- 合成公开配置下默认生产构建与build:preview均通过；dist-preview/index.html资源base及文件存在检查通过。
- 新预览工作流YAML解析、Repository变量绑定、contents:read权限及无Pages部署动作检查通过；正式部署工作流与数据库目录完全未修改。
- 没有创建新仓库、发布网站、远程数据库操作或修改Supabase配置。预览artifact生成不代表站点已上线，真实预览项目与iPhone验收等第二阶段授权。
