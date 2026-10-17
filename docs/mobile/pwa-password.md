# 密码体验与在线 PWA（2026-10-17）

## 密码规则与服务器状态

注册和设置新密码要求至少12个字符，同时含ASCII大写A–Z、小写a–z和数字0–9。输入时四项文字规则实时显示已满足/未满足，不只依赖颜色。按钮禁用与提交处理器均验证；不会去除或改写用户密码。

登录只要求非空，不套用新的长度/组合规则，不强迫已有短密码账号改密码。Supabase密码过短、字符规则不符、弱密码和泄露密码错误分别显示中文；服务器返回不同最小长度时显示其实际长度。错误只转换固定安全文本，不记录或回显密码、原始错误或令牌。

**尚未核实真实 Supabase 密码策略。** 当前环境没有Supabase管理端授权或管理配置访问能力；公开publishable key及“注册成功”不能证明服务器强制大小写/数字。我们没有修改任何Auth安全设置，也没有用弱密码在真实项目注册探测账号。

请在测试项目 Supabase Dashboard → Authentication → Sign In / Providers → Email 的 Password security/Password requirements 区域（控制台版本可能归入Auth Settings）读取：

1. Minimum password length应为12或更高。
2. Required characters选择同时要求小写、大写、数字的选项；不只是建议强度或仅设最小长度。
3. 保持Email验证和现有RLS不变。如服务端未满足上述两项，请先审核再手动保存此策略；本轮未代为更改。若额外启用特殊字符、泄露密码保护，须同步产品说明；客户端会显示服务端拒绝。
4. 使用专用测试邮箱，在本地API工具绕过前端检查：短于12、缺大写、缺小写、缺数字应返回明确密码策略错误；符合规则可注册并收到验证邮件。不要把invalid email、验证码或429限流当成密码规则已生效。若弱密码意外注册成功，停止测试并审核服务器设置，不批量创建账号。
5. 再验证已有账号原密码仍可登录、新注册及重置执行新策略。不要发送服务端密钥或把测试密码/JWT写入报告。

前端校验是体验层，**不是服务器安全强制的证据**。

## iPhone 安装与登录

从Safari打开预览入口，分享→添加到主屏幕，名称为“每日进步”。manifest提供standalone显示、正确start_url/scope/id、192/512 PNG；Apple Touch Icon为180 PNG。图标为项目独立绘制的矢量和生成PNG，源文件在public/icons/source.svg，可用已有Playwright依赖运行scripts/render-icons.mjs重新生成。

预览和正式base分别生成独立manifest id与入口：

- /habit-tracker-preview/ → /habit-tracker-preview/manifest.webmanifest
- /habit-tracker/ → /habit-tracker/manifest.webmanifest

icons与资源、注册验证/密码重置回调均使用各自base。SDK存储键保持此前预览专用/正式默认隔离；旧daily-progress数据不读、不改。页面前台恢复和pageshow重新读取云端；断网立即禁止保存，没有待发队列。

iOS可能将主屏幕应用和Safari标签页的存储分开，首次从主屏幕打开可能需重新登录。此后由该入口的SDK保持会话；账号数据始终在云端，可再次登录恢复。私密浏览、系统清理或存储回收不能保证永久保留本地会话。不能宣称已在真实iPhone安装验收通过。

## 不注册 Service Worker，避免跨应用缓存干扰

本版是**联网使用的可添加主屏幕Web应用**，没有Service Worker注册、应用壳预缓存、API缓存或后台同步。Safari添加主屏幕/standalone不要求离线缓存。无离线打卡、离线冷启动或离线写入承诺。

两条manifest scope只是应用入口范围，不是浏览器安全沙箱；同一github.io仍同origin。应用不会unregister任何已有worker，不调用CacheStorage清空全站。若页面发现已被已有worker控制，会在安装说明中提醒；真实设备上的历史root worker仍需人工检查，不能从代码断言不存在。

资源文件名使用内容hash；不设长期index缓存。GitHub Pages/CDN本身的HTTP缓存仍可能短时保留HTML，无法仅靠manifest保证即时更新。加载模块失败或启动失败有固定中文恢复入口，手动“联网重新加载”给页面增加_refresh参数并保留邮箱回调fragment；不会自动循环刷新或删除云端数据。

**后续人工更新时保留旧hash资源**，先上传新assets/icons/manifest，再更新index，或使用一次原子Pages部署。不要仅覆盖index后删除旧assets，否则设备短期缓存的旧HTML可能404。旧版本没有新恢复入口，保留旧资源尤其重要。现有图标在iOS上可能需移除旧主屏幕快捷方式后重新添加；不要为更新图标清空整个github.io存储。

## 新产物及发布边界

预览产物应完整保留：

```
index.html
manifest.webmanifest
icons/
  icon-192.png
  icon-512.png
  apple-touch-icon.png
  source.svg
assets/
  index-<hash>.js
  index-<hash>.css
```

`npm run build:preview`输出dist-preview并检查链接、manifest和PNG尺寸。GitHub“手机端独立预览构建（不部署）”使用已有真实公开Repository variables，成功后artifact名为habit-tracker-preview-<完整提交SHA>，保留7天。本地构建使用合成配置，仅验证路径和打包，不可作为真实项目预览包上传。

本轮仅提交开发分支并生成构建，不上传habit-tracker-preview，不发布任何网站，不合并main，不改数据库或已有打卡，不修改Supabase配置。正式构建仅本地测试，不等于部署正式网站。

## iPhone 人工验收清单

用户另行决定更新预览文件后：

1. Safari核对注册规则实时变化，弱密码不能提交；符合规则注册、邮箱返回预览入口。核对真实服务端规则和中文错误，而非只看前端。
2. 添加主屏幕，核对名称/图标/独立窗口。首次必要时登录；创建、打卡、后台挂起再打开、关闭后重开、刷新、退出重登都应恢复云端结果。
3. 在实际iPhone上确认键盘不会遮挡提交、输入字号不触发不必要缩放、底部安全区域和44px触控高度。不能用Chromium截图代替Safari验收。
4. 飞行模式时已打开页面不能保存、不显示已同步；联网刷新后核对云端结果，没有自动离线重放。离线冷启动不在支持范围。
5. 查看正式旧站仍正常、旧数据未改；预览退出不会清除正式Auth会话。若曾有root Service Worker，使用Safari Web Inspector只读检查其script/scope，单独制定修复，不清空整个origin。
6. 更新后正常重新打开或使用恢复按钮读取新资源；如CDN尚未更新，等待缓存刷新，并保留旧hash资源。不要声称所有设备实时升级。
