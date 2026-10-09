# 每日进步

一款中文习惯打卡网页应用。从每天一件小事开始，看见自己的积累。

第一版使用 React + TypeScript + Vite，免注册，数据保存在当前浏览器。适配电脑和手机，不使用云数据库、登录系统、广告或追踪。所有应用逻辑与界面独立实现，没有复制调研项目的代码、Logo或图片。

## 如何在电脑预览

1. 安装 **Node.js 24 LTS**（会同时安装 npm）。在终端运行 `node -v`，应显示 `v24…`。
2. 下载或克隆此仓库，切换到开发分支：

   ```bash
   git clone https://github.com/LMeng0716-droid/habit-tracker.git
   cd habit-tracker
   git switch feat/daily-progress-v1
   ```

3. 安装锁定版本的依赖：

   ```bash
   npm ci
   ```

4. 启动本地开发服务器：

   ```bash
   npm run dev
   ```

5. 在浏览器中输入终端显示的本地地址（通常是 `http://localhost:5173/habit-tracker/`）。关闭服务器时，在终端按 **Ctrl+C**。如果端口被占用，Vite会提示另一个端口。

这里运行的是自己电脑上的服务器，不会把网站发布到互联网。请不要双击 index.html；应用需要通过开发服务器或构建预览运行。

## 如何用手机预览

电脑和手机连接同一个可信的Wi-Fi，在电脑终端运行：

```bash
npm run dev -- --host 0.0.0.0
```

在手机浏览器输入终端显示的 **Network** 地址，例如 `http://192.168.1.20:5173/habit-tracker/`。如果连不上，检查两台设备的网络、电脑防火墙是否允许该端口，以及Wi-Fi是否隔离设备。此方式用于本地调试，不是公网部署；不需要账号。

**电脑 localhost、电脑局域网IP和手机浏览器是不同的数据空间。** 它们不会自动同步。端口、协议或域名改变也可能切换到另一份本地数据；需要迁移时使用JSON导出与导入。

## 如何使用

- **今天**：点击“添加习惯”，输入1～30个字并选择颜色；每个习惯每天记录一次。点击“今日打卡”完成，误点后可通过“已完成 · 撤销打卡”撤销。
- **习惯详情**：点击习惯名称。月历从周一开始，点击日期后再确认补记或撤销。未来日期、创建前日期不能修改。
- **连续天数**：今天完成，从今天往前计算；今天还未完成时，昨天结束的连续仍保留。漏过一整天后当前连续归零，历史最长和累计记录不会清零。
- **统计**：选择月份，查看完成天数/有效天数及完成率。当前月只计算创建后至今天的日数，不把未来天数算进去；没有有效日时显示“暂无数据”。当前和最长连续使用全部历史。
- **编辑**：修改名称或颜色，不会改动历史。
- **归档**：从习惯详情归档，保留此前历史，不再显示于今天。归档当天的打卡会移除；归档之后只读，第一版不支持恢复为活跃习惯。设置中可以打开归档历史。
- **永久删除/清空**：都会二次确认，操作不能撤销，建议先备份。

## 备份与恢复

在“设置”中点击“导出 JSON 备份”，浏览器会下载一个包含全部习惯和记录的文件。请妥善保存，可在其他设备上手动导入。

导入支持本应用的v1 JSON格式，最大 **5 MiB**。选择文件后先校验并展示习惯/记录数量，确认后**整体替换**当前数据，不会合并；可先导出替换前的数据。坏JSON、未知版本、重复ID或记录、无效日期、未来日期、未知习惯引用都会拒绝，原数据不变。

数据损坏时应用进入恢复模式，不自动写入空数据。可导出原始内容留存，再从合法备份恢复；空间或权限不足时进入只读模式，已有有效数据仍可查看、导出。其他标签页修改数据时，旧页面会停止写入并提示刷新。

**本地存储不是永久备份，也没有加密。** 清除浏览器站点数据、更换设备或浏览器可能丢失记录，请定期导出。第一版不保证离线加载，不要把关闭网络后无法打开误认为记录已丢失。

## 构建和测试

```bash
npm test                 # 日期、连续、统计、备份校验和存储测试
npm run type-check       # TypeScript类型检查
npm run build            # 类型检查后生成dist目录
npm run preview          # 本地预览构建结果，通常使用4173端口
npm run format:check     # 检查代码格式
```

浏览器端到端测试需要 Chromium。首次执行：

```bash
npx playwright install chromium
npm run test:e2e
```

Linux如果缺少浏览器系统库，可使用Playwright官方安装命令 `npx playwright install --with-deps chromium`（可能需要系统安装权限）。如已安装兼容的Chromium，也可指定可执行文件，避免重复下载：

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

浏览器测试会自行启动本地开发服务器。CI会执行安装、格式检查、单元测试、构建及Chromium端到端测试，不部署。

## 项目结构

```text
src/
  App.tsx          页面与状态协调（今天、详情、统计、设置）
  components.tsx   弹窗、习惯表单与月份选择
  domain.ts        真实日期、连续/月统计、备份校验与数据变更
  storage.ts       加载与保存、版本冲突保护
  main.tsx         React入口
  styles.css       原创响应式样式
  *.test.ts        数据与存储测试
tests/             真实浏览器测试
docs/              调研、需求、开发计划与验收记录
```

依赖版本记录于package-lock.json，使用 `npm ci` 可复现，不提交 node_modules 或 dist。初学者可先阅读domain.ts了解数据规则，再阅读components.tsx和App.tsx了解界面。

## 当前限制与后续完善

- 只支持每天一次、单设备本地记录。暂无周频率、计量目标、暂停、归档恢复、通知、PWA离线、云同步或登录。
- 日期根据设备本地日历计算。跨时区时旧记录日期不改；系统时钟错误可能影响打卡/导入范围，请校正时间后刷新。
- 多窗口使用冲突提示保护，不支持实时协作；极端同时写入仍可能竞争，建议在一个标签页编辑。
- 单元测试已包含50个习惯、两年记录样本，但没有为大量附件或日记设计存储。
- Chromium自动验收结果见[验收记录](docs/validation.md)。真实iPhone Safari、Android手机和Firefox仍需人工验收，不能声称已全部通过。
- 搜索、主题、CSV导出可根据实际反馈再加入。发布前仍需确定本项目许可证；当前没有自动沿用参考项目的许可。

调研和原始规划分别见[开源调研](docs/open-source-research.md)、[产品需求](docs/product-requirements.md)、[开发计划](docs/development-plan.md)。

## GitHub Pages 自动部署

目标地址：<https://lmeng0716-droid.github.io/habit-tracker/>。

仓库管理员首次需要打开 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。然后合并部署配置PR到main；以后main更新会自动构建并部署。也可以在 **Actions → 部署到 GitHub Pages → Run workflow** 选择main手动触发。其他分支不会部署，PR本身不会发布。

部署工作流使用Node24、npm ci、现有单元测试及生产构建，将dist交给官方Pages Actions。原有check.yml保持独立，继续执行完整检查和浏览器测试。请在Actions中查看实际部署结果；本地构建通过不代表网站已上线。

Vite的base为 `/habit-tracker/`，构建资源使用该前缀；应用使用哈希路由，详情/统计页刷新不需要服务器重写或404跳转。index.html中的入口由Vite处理，不应手动给源码入口重复添加仓库前缀。

GitHub Pages上的数据与本地预览分开保存；上线后如需迁移原记录，请在原浏览器地址导出JSON，再在Pages站点导入。
