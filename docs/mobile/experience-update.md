# 手机端体验更新与待批准事项

## 已实施与边界

- SDK 原有 persistSession/autoRefreshToken 默认开启；没有关闭页面、后台或刷新时登出的代码。无法据现有日志确认用户偶发重登根因。Safari 与主屏幕 PWA 可能使用不同存储，首次独立窗口需登录一次；iOS 清理站点存储也可能造成重登。
- 登录元数据按 base、Supabase host 和用户 ID 隔离。只有交互式登录/注册产生会话、密码恢复建立起点；自动 SIGNED_IN、INITIAL_SESSION、TOKEN_REFRESHED 不重置期限。点击和键盘活动更新活跃时间；自动读取、页面唤醒和定时器只检查期限。
- 7 天空闲及 30 天最长登录均在边界到达时失效。恢复、可见页定时检查和读写前检查；时间大幅倒退（超过一分钟）或记录缺失/损坏要求重登，向前跳动可能提前超时。升级前无元数据会话首次需重登。前端时间/存储可以修改，不能作为数据库安全边界，RLS 不变。
- 超时清除内存业务数据并请求 SDK local signOut，仅作用当前 Auth key；SDK 当前版本在远程退出失败时也移除本地会话；超时元数据仍保留，后续恢复继续拒绝旧会话，联网后可重新登录。已提交云端数据不删除。未提交表单超时后需要重新填写。
- 未添加 Service Worker/离线写入，正常 SDK 刷新依旧需要网络。底部安全区和 44px 触控保持。

## Emoji 待批准方案（未实现自选或云端保存）

当前 habits 只有 name/color/日期等字段，不复用名称或颜色塞入 Emoji。UI 暂显示统一 🌱 装饰，不能代表用户自选图标已同步。
建议批准后新增独立迁移：habits.emoji text NOT NULL DEFAULT '🌱'；限制为十个预设 Emoji。仅给 authenticated 新列 INSERT/UPDATE 权限，保留全部 RLS/FORCE RLS；更新 create_habit/edit_habit 的新可选末尾参数和 read_snapshot 返回值，避免保留旧重载造成 PostgREST 歧义。旧前端原参数调用需继续匹配，新前端在旧数据库前禁止发送新参数。默认填充保留所有习惯和打卡；事务安装，在独立测试库验证旧客户端、新客户端、权限和回滚，再人工执行。未编写或执行此迁移，等待批准。

## Supabase 人工配置（未读取或修改真实设置）

Authentication → Settings/Sessions（控制台名称可能不同）：确认当前套餐支持的 Time-box user sessions 为 30 天、Inactivity timeout 为 7 天。通常属于付费套餐能力，且在刷新会话时检查，不是即时撤销已有 JWT。服务端 inactivity 指令牌刷新间隔，不能严格等同真实点击活跃；本轮前端仍独立统计操作。
Authentication → Sign In / Providers → Email：确认 Minimum password length = 12，Password requirements 启用 lowercase、uppercase、digits。符号允许但无需强制。当前无管理权限，未验证真实策略；不可声称前端规则等于服务端强制。已有账号登录不新增强度校验。
不要修改数据库、密码或密钥；不提供 service_role。

## iPhone 人工验收与图标更新

1. 用户自行取得新预览 artifact 后，仅更新独立预览仓库。根目录 index.html、manifest.webmanifest，保留 assets/ 和 icons/ 目录及旧 hashed assets，防止旧页面加载失败。此任务不发布。
2. Safari 打开预览、注册/验证/登录、创建/修改/打卡/取消、历史与归档；确认刷新和退出重登恢复。另账号验证隔离（自动化网络 mock 不是服务端验证）。
3. 如旧主屏幕图标未更新，删除主屏幕入口并从 Safari 重新添加“每日进步”。不要选择清除网站数据或清除缓存。系统可能隔离/移除独立窗口存储，必要时登录一次，云端记录仍在。
4. 从主屏幕冷启动、切后台、锁屏、联网恢复、第二天打开应恢复同账号。测试 7 天及 30 天可在独立测试设备/账号调整本应用元数据，勿改日常设备系统时间；确认边界重登后记录保留。
5. 确认小图标清晰、更多操作可展开、320–430px 无横向溢出、输入不自动放大、底栏无遮挡，系统减少动态效果时无对勾动画。

本地 Chromium 不等于真实 Safari；真实服务端密码策略、邮件回调、JWT/RLS、iPhone 存储淘汰和主屏幕表现仍需人工验收。

## 本轮验证记录

2026-10-17：最终 Chromium 两个 Base 合计 30 passed、2 skipped（原有不适用路径的两个用例）；期限/密码恢复专项 6 passed。首次回归发现并修复按钮无障碍名称与折叠菜单测试交互问题，以及 recovery 与延迟超时退出竞态；中断的旧测试运行不计入通过结果。TypeScript、Prettier、生产/预览构建和预览资源尺寸检查通过。构建本地使用公开格式测试配置，不连接真实 Supabase。一次与浏览器并行的单元运行出现 CLI 子进程 5 秒超时，随后以串行完整结果为准。未增加 skip 或关闭断言。
