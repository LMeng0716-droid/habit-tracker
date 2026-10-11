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
