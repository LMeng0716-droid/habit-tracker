# 独立预览第一阶段：仅构建，不发布（2026-10-17）

## 边界

本阶段只修改feat/mobile-cloud-tracker。没有创建habit-tracker-preview仓库、配置Pages、发布网站、合并main、修改数据库或Supabase/Repository variables。现有正式Pages工作流和生产base保持不变。

目标预览地址（**尚未上线**）：`https://lmeng0716-droid.github.io/habit-tracker-preview/`。
正式地址保持：`https://lmeng0716-droid.github.io/habit-tracker/`。

## 构建流程

新增 `.github/workflows/preview-build.yml`，只在手机开发分支push触发，权限仅contents:read，无pages:write/id-token/deploy-pages。读取原仓库已有VITE_SUPABASE_URL和VITE_SUPABASE_PUBLISHABLE_KEY Variables，执行已有安全校验、单元测试、类型检查及预览构建。

`npm run build:preview`复用npm run build，CLI覆盖base为`/habit-tracker-preview/`，输出到`dist-preview/`（git忽略）。脚本检查index.html所有入口资源使用该base且对应文件存在。`npm run build`默认仍输出`dist/`，正式base仍是`/habit-tracker/`。

产物以 `habit-tracker-preview-<完整提交SHA>` 上传为普通Actions artifact，保留7天。不是Pages artifact，不会部署。可在“手机端独立预览构建（不部署）”的成功run中下载；过期可重跑该run。artifact包含公开URL和publishable key，这是浏览器应用必需配置，不含服务端密钥。

预览构建使用真实Variables，但格式构建成功不等于远程Supabase功能通过。无法从本地读取GitHub变量，因此本地使用合成公开配置；远端结果须另行查看。

## Auth和旧数据隔离

只在预览base下显式指定Auth storageKey：`habit-tracker-preview:<项目host>:auth`。正式base不传storageKey覆盖值，保留Supabase SDK默认`sb-<项目ref>-auth-token`。SDK派生的PKCE verifier和跨标签广播名称跟随storageKey，预览不自动读取/迁移正式Auth会话。

产品业务层没有localStorage/sessionStorage/cookie读写：业务数据只来自云端。旧daily-progress:v1/v2不读、不清空；浏览器测试在相同origin下预置正式Auth会话和旧业务键，确认预览不会自动登录，登录/退出不删除正式会话和旧键。

这只是应用级存储命名隔离，**两个GitHub Pages路径仍同origin，不是安全沙箱**。预览也连接已有Variables指定的同一Supabase数据库，不是数据库副本；发布前应确认指向验收测试项目。

## 路径与回调

回调使用当前origin加构建BASE_URL，预览注册验证和密码重置目标为：

`https://lmeng0716-droid.github.io/habit-tracker-preview/`

第二阶段发布前请在Supabase Redirect URLs新增上述精确地址，保留正式地址，Site URL不必改。本阶段不自动更改。页面导航为内存状态，不使用子路径路由；刷新根入口与邮箱hash回调无需服务器SPA重写。

自动化浏览器对production/preview两个base分别验证登录、保存、刷新、退出重登、历史、归档、注册/重置请求的redirect_to，以及PASSWORD_RECOVERY返回。仅为模拟API与Chromium，不验证真实JWT、邮件或iPhone。

## 本地验证命令

配置合成或测试项目公开变量后：`npm test`、`npm run type-check`、`npm run format:check`、`npm run build`、`npm run build:preview`、`npm run test:e2e`。Playwright同时启动两个本地开发服务，完整业务套件分别覆盖两条base；专属存储断言只运行于对应项目。

## 下一阶段，仍需用户确认

1. 用户再次授权后才创建预览仓库并配置Pages。
2. 用户手动添加精确Redirect URL，并确认Variables指向测试项目。
3. 选择已通过构建的准确SHA artifact发布到新仓库，不从正式仓库部署流程发布。
4. 发布后用iPhone Safari真实验收注册/验证邮件、登录、创建/打卡、刷新恢复和退出重登。

下载artifact后直接用file://打开不能作为真实认证验收；本阶段没有可用的在线预览入口。
