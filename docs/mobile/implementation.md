最新构建校验和真实环境验收要求见 [config-and-acceptance.md](config-and-acceptance.md)；本文的未配置提示仅适用于开发模式，生产构建现在会拒绝缺失配置。

# 手机端云存储：实施与人工验收

## 当前产品

手机浏览器优先；邮箱认证；每天一次的习惯；创建/编辑/归档、打卡/取消、历史日历、连续自然日和完成率。业务数据唯一来源是 Supabase。清除浏览器后重新登录同一账号即可读取历史。浏览器仅持久化 Supabase Auth 会话，没有业务离线队列，不读取、不上传、不清除旧 daily-progress localStorage。

不提供分类、备注、排序、自定义周期、JSON 导入或增量同步。旧数据库设计留存用于审计，不是新产品的安装依赖。旧本地业务代码和相应测试已替换，不能拿旧测试数量作为新产品测试通过数。

最新列授权和空库/回滚专项验证见 [permissions-review.md](permissions-review.md)。

## 两表及安全

新 schema 为 habit_mobile，与旧 habit_api/habit_private 独立，不删除、迁移或覆盖旧云端对象。两张表 habits 和 habit_checkins；用户由 auth.users 管理。习惯 ID 为客户端生成文本 UUID，已有文本 ID 没有被转换。复合主键和外键限制记录只能归属于同一用户的习惯，打卡自然键 user_id/habit_id/date 唯一。

全表 ENABLE/FORCE RLS。客户端不能填写/修改 user_id、created_date、created_at；没有习惯 DELETE 或打卡 UPDATE 权限。写入列权限、RLS、trigger共同约束直接 Data API 请求，绕过前端也不能改身份、造未来记录或修改已归档数据。触发器需要权限时使用请求本人的 authenticated 权限，不是 SECURITY DEFINER。

五个普通 SECURITY INVOKER RPC：read_snapshot、create_habit、edit_habit、archive_habit、set_checkin；两个触发器函数不授予客户端 EXECUTE。固定空 search_path；anon/PUBLIC 无 RPC EXECUTE。没有 CREATE ROLE、Auth 权限转授或 ALTER FUNCTION OWNER，规避此前托管 postgres 缺少 Auth GRANT OPTION 的问题。依然要求 authenticated 本身可使用 auth.uid、迁移管理员可 REFERENCES auth.users。

read_snapshot 在一个 SQL 查询中聚合两表，避免分别查询期间发生写入造成混合状态，也避免 PostgREST 的列表行数上限截断历史。对个人规模全量读取足够；尚未压测多年巨量历史。客户端不把整个快照写回数据库。

set_checkin 使用明确 true/false，唯一约束及 ON CONFLICT 保证重复完成不复制；取消删除实际记录。RPC及trigger锁住同一习惯，归档与打卡串行。create_habit使用固定ID重试；同ID不同内容拒绝；编辑为简单最后成功写入生效，不实现版本冲突UI。网络错误不宣称保存成功，先刷新核对；保存已确认但刷新失败明确区分。没有自动离线重放。

## 日期和归档

北京时间 Asia/Shanghai 为固定业务时区。created_date、archived_on和打卡date均为 date；时间戳为 timestamptz。客户端显示日期以 read_snapshot 返回的 today 为准，重新进入页面、联网、主动刷新和日期跨午夜时重新读取。

所有习惯每天一次，从 created_date 到今天计入每日/月度统计；归档后截止 archived_on（包含当天），不影响之前记录。归档保留当天打卡，历史只读、不能取消归档。没有任何永久删除入口。

连续天数为连续自然日；今日未打卡可显示截至昨天的连续数。归档习惯显示“归档时连续”和最长连续数。无有效日期完成率显示“暂无统计”。

## 测试数据库检查与部分初始化

1. 确认 SQL Editor 当前是 habit-tracker-test，先执行 `supabase/checks/mobile-state.sql`。它只读，包含旧/新对象、owner/RLS/约束/权限；精确计数SQL仅输出，审核后可逐条执行。不要粘贴 local-bootstrap、测试fixture或并发脚本到真实项目。
2. 旧 habit_api 已存在不代表损坏；旧 001/002 无重复执行安全性。不要重跑，不加 IF NOT EXISTS 掩盖结构差异，不 DROP 对象。保留旧数据和对象；新应用不调用这些schema。
3. 如果 habit_mobile 不存在，审核后**只人工执行完整 `202610110001_mobile_cloud.sql`**。无需先运行旧001/002，禁止直接用 Supabase CLI db push 扫描全部历史migration目录。文件包含BEGIN/COMMIT，一次性安装；成功后不要重复执行。
4. 如果 habit_mobile 已存在，停止安装并用只读检查清点完整性。完整相符则视为已安装并验收；不完整则保留数据、输出差异，再单独审核追加修复迁移。不要自动覆盖或删掉重建。不能仅凭schema存在认定成功。
5. 失败的本次迁移应整个回滚；若 SQL Editor 连接仍在 aborted transaction 中先 ROLLBACK。001之前已提交的旧对象不会回滚。保留精确错误，修正依赖后再审核重试，不能降低RLS或改高权限业务执行角色。

## Supabase 控制台

- Data API 启用，并添加 exposed schema **habit_mobile**。新前端只访问此schema；不需要暴露 habit_private/auth。旧 habit_api 是否撤下需另行审核，本PR不操作远程配置。
- authenticated 有habit_mobile USAGE，表读取和迁移中明确列写入权限，以及五个RPC EXECUTE；anon 无业务访问。权限由新迁移提供。保持所有RLS开启并FORCE。
- Email provider开启，建议邮箱验证开启。密码至少8字符，并配置平台密码政策/邮件发送。
- Site URL与Redirect URLs包含实际测试网站地址及正式 `https://lmeng0716-droid.github.io/habit-tracker/`。本地验证另加 `http://localhost:5173/habit-tracker/` 或实际本地地址。不要把任意通配符加入正式回调。
- 复制项目URL和**publishable key**。不需要service_role、secret key、数据库密码或Realtime。

## 前端配置及部署边界

本地复制 `.env.example` 内容到 `.env.local`（git忽略），填写测试项目的公开配置后执行npm ci/npm run dev。Vite变量为 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY；只接受HTTPS URL和sb_publishable_前缀。没有配置时显示设置提示，不回退localStorage，也不上传旧数据。

未来明确批准正式发布时，GitHub仓库 Actions Variables设置同名两项**公开配置**；Pages build读取这些变量。此次仅让工作流可读取配置，没有设置仓库变量、触发部署、合并main或提供生产项目配置。base仍为/habit-tracker/。main push部署规则保留，所以不要未经审核合并本PR。JWT、刷新令牌、密钥和数据库密码不得提交或写入验收报告。

## 人工验收

1. 独立测试项目安装并执行只读检查，确认两张表FORCE RLS、所有函数SECURITY INVOKER、客户端不能删除习惯或修改owner。
2. 手机注册真实邮箱A，验证邮件返回应用，登录；测试错误密码、重置邮件及设置新密码。真实邮件回调/GoTrue不在本地模拟测试覆盖范围。
3. A创建两项习惯，编辑名称和颜色，打卡/取消；刷新及浏览器重开后结果一致。日历只能操作创建日至今天。输入月份查看完成率和连续天数。
4. 打卡后归档，确认当天记录仍在、统计不消失、历史只读；重复归档不丢数据。
5. 登出后不可见之前数据；清除浏览器数据，再登录A恢复全部习惯和历史；另一台手机登录A也能读取。当前没有实时推送，另一端须刷新。
6. 注册真实B：查询只见本人；用B JWT调用A习惯ID编辑/归档/打卡均失败；直接表查询A返回空，伪造owner插入或改owner失败，直接未来打卡失败。匿名、过期和伪造JWT不能访问。用测试API工具完成，不使用SQL Editor管理员代替真实JWT测试。
7. 断网保存：显示失败，不显示“已保存”；输入保留，联网后刷新核对，再尝试。对同一操作重复点击/重试，确认不会重复打卡。保存成功但读取失败应显示单独提示。
8. 两个手机同时打卡或归档，检查数据库唯一性及历史一致；编辑无需版本合并，最后成功编辑生效。
9. 在真实iPhone Safari检查键盘、月份选择器、44px触控按钮、底部导航、安全区域、屏幕旋转和邮箱回调。本地Chromium模拟触控不等于iPhone验证。

## 恢复

本次没有自动down migration或远程删除操作。测试安装失败保留现场；已提交后有问题，暂停测试使用并保留表/数据，再追加修复。正式前端尚未切换，现有上线版本不受分支代码影响。旧本地数据没有迁移，也没有主动清空。上线前必须完成真实测试项目验收，另行批准生产配置和部署。
