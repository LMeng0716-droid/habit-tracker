import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const key = "daily-progress:v2";
const today = "2026-10-09";
const fixture = {
  schemaVersion: 1,
  revision: "fixture",
  habits: [
    {
      id: "reading",
      name: "阅读10分钟",
      color: 0,
      createdDate: "2026-09-28",
      createdAt: 1,
    },
  ],
  completionRecords: [
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-07",
    "2026-10-08",
  ].map((date) => ({ habitId: "reading", date })),
};
const file = (content: unknown) => ({
  name: "backup.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(content)),
});
async function start(page: Page) {
  await page.clock.install({ time: new Date("2026-10-09T10:00:00+08:00") });
  await page.goto("/");
}
async function add(page: Page, name = "阅读10分钟") {
  await page.getByRole("button", { name: "＋ 添加习惯" }).click();
  await page.getByRole("textbox", { name: "习惯名称" }).fill(name);
  await page.getByRole("button", { name: "保存习惯" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function seed(page: Page) {
  await page.evaluate(
    ({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)),
    { key, fixture },
  );
  await page.reload();
}
test("主流程：新建、编辑、打卡、刷新、撤销、备份清空恢复", async ({ page }) => {
  await start(page);
  await add(page);
  await page.getByRole("button", { name: "编辑阅读10分钟" }).click();
  await page.getByRole("textbox", { name: "习惯名称" }).fill("阅读15分钟");
  await page.getByRole("button", { name: "保存习惯" }).click();
  await page.getByRole("button", { name: "＋ 今日打卡" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "✓ 已完成 · 撤销打卡" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "✓ 已完成 · 撤销打卡" }).click();
  await page.getByRole("button", { name: "＋ 今日打卡" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "设置" })
    .click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON 备份" }).click();
  const download = await pending;
  const raw = await readFile((await download.path())!, "utf8");
  expect(JSON.parse(raw).completionRecords).toHaveLength(1);
  await page.getByRole("button", { name: "清空全部数据", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByLabel("选择JSON备份").setInputFiles({
    name: "saved.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await expect(page.getByRole("dialog")).toContainText("1 个习惯、1 条记录");
  await page.getByRole("button", { name: "确认替换并导入" }).click();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "今天" })
    .click();
  await expect(page.getByRole("link", { name: "阅读15分钟" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "✓ 已完成 · 撤销打卡" }),
  ).toBeVisible();
});
test("月历补记、跨月连续、统计口径、只读日期和浏览器返回", async ({ page }) => {
  await start(page);
  await seed(page);
  await page.getByRole("link", { name: "阅读10分钟", exact: true }).click();
  await expect(
    page.getByText("当前连续", { exact: true }).locator(".."),
  ).toContainText("2天");
  await expect(
    page.getByText("历史最长连续", { exact: true }).locator(".."),
  ).toContainText("4天");
  await expect(
    page.getByRole("button", { name: "2026-10-10 不可操作" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "2026-10-06 未完成", exact: true })
    .click();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).completionRecords.length,
      key,
    ),
  ).toBe(6);
  await page.getByRole("button", { name: "确认补记" }).click();
  await expect(
    page.getByText("当前连续", { exact: true }).locator(".."),
  ).toContainText("3天");
  await page
    .getByRole("button", { name: "2026-10-07 已完成", exact: true })
    .click();
  await page.getByRole("button", { name: "确认撤销" }).click();
  await expect(
    page.getByText("当前连续", { exact: true }).locator(".."),
  ).toContainText("1天");
  await page.getByLabel("查看月份").fill("2026-09");
  await expect(
    page.getByRole("button", { name: "2026-09-27 不可操作" }),
  ).toBeDisabled();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "今天，向前一小步" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "统计" })
    .click();
  await page.getByLabel("查看月份").fill("2026-10");
  await expect(page.getByText("3 / 9 个有效日完成")).toBeVisible();
  await expect(page.getByText("33%", { exact: true })).toBeVisible();
});
test("归档去掉当天记录、保留历史，只读且可永久删除", async ({ page }) => {
  await start(page);
  await seed(page);
  await page.getByRole("button", { name: "＋ 今日打卡" }).click();
  await page.getByRole("link", { name: "阅读10分钟", exact: true }).click();
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("当天打卡记录将被移除");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(saved.habits[0].archivedDate).toBe(today);
  expect(saved.completionRecords).toHaveLength(6);
  await page.getByRole("link", { name: /阅读10分钟/ }).click();
  await expect(
    page.getByRole("button", { name: "2026-10-08 已完成" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("heading", { name: "阅读10分钟" })).toBeVisible();
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("从一个小习惯开始")).toBeVisible();
});
test("坏备份不修改数据，合法备份取消也不替换", async ({ page }) => {
  await start(page);
  await add(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "设置" })
    .click();
  const old = await page.evaluate((key) => localStorage.getItem(key), key);
  await page
    .getByLabel("选择JSON备份")
    .setInputFiles(file({ ...fixture, schemaVersion: 2 }));
  await expect(page.getByRole("status")).toContainText("导入失败");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    old,
  );
  await page.getByLabel("选择JSON备份").setInputFiles(file(fixture));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    old,
  );
});
test("损坏数据保持原文并可通过验证的备份恢复", async ({ page }) => {
  await start(page);
  await page.evaluate((key) => localStorage.setItem(key, "broken"), key);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("数据需要恢复");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    "broken",
  );
  await expect(
    page.getByRole("button", { name: "＋ 添加习惯" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "从备份恢复" }).click();
  await page.getByLabel("选择JSON备份").setInputFiles(file(fixture));
  await page.getByRole("button", { name: "确认替换并导入" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key))!)
      .habits,
  ).toHaveLength(1);
});
test("写入失败不伪成功、数据仍可导出", async ({ page }) => {
  await start(page);
  await add(page);
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw new DOMException("空间不足", "QuotaExceededError");
      return original.call(this, k, v);
    };
  }, key);
  await page.getByRole("button", { name: "＋ 今日打卡" }).click();
  await expect(page.getByRole("alert")).toContainText("未保存修改");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    before,
  );
  await expect(
    page.getByRole("button", { name: "＋ 今日打卡" }),
  ).toBeDisabled();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "设置" })
    .click();
  await expect(
    page.getByRole("button", { name: "导出 JSON 备份" }),
  ).toBeEnabled();
});
test("多窗口存储冲突使旧窗口只读，不覆盖新数据", async ({ page, context }) => {
  await start(page);
  await add(page);
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "＋ 今日打卡" }).click();
  await expect(page.getByRole("alert")).toContainText("其他窗口已修改数据");
  await expect(
    page.getByRole("button", { name: "＋ 今日打卡" }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "✓ 已完成 · 撤销打卡" }),
  ).toBeVisible();
});
test("360px手机无溢出，弹窗焦点、退出未保存提示、中文名称校验", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await start(page);
  await page.getByRole("button", { name: "＋ 添加习惯" }).click();
  const input = page.getByRole("textbox", { name: "习惯名称" });
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "保存习惯" }).click();
  await expect(page.getByRole("alert")).toContainText("1～30");
  await input.fill("阅读");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "保存习惯" }).click();
  await expect(page.getByRole("button", { name: "＋ 添加习惯" })).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/mobile-today.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "阅读", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/mobile-calendar.png",
    fullPage: true,
  });
});
test("本地午夜切换今天，昨天连续仍保留", async ({ page }) => {
  await start(page);
  await add(page);
  await page.getByRole("button", { name: "＋ 今日打卡" }).click();
  await page.clock.setSystemTime(new Date("2026-10-10T00:00:01+08:00"));
  await page.clock.runFor(1100);
  await expect(page.getByRole("button", { name: "＋ 今日打卡" })).toBeVisible();
  await expect(page.locator(".streak")).toContainText("1 天连续");
});

test("初始化写入权限不足仍展示已有记录并允许导出", async ({ page }) => {
  await start(page);
  await seed(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("存储不可写", "SecurityError");
    };
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("数据仍可查看或导出");
  await expect(
    page.getByRole("link", { name: "阅读10分钟", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "＋ 今日打卡" }),
  ).toBeDisabled();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "设置" })
    .click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON 备份" }).click();
  const raw = await readFile((await (await pending).path())!, "utf8");
  expect(JSON.parse(raw).completionRecords).toHaveLength(6);
});

test("局域网HTTP使用的随机ID不依赖secure-context randomUUID", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined }),
  );
  await start(page);
  await add(page);
  await page.getByRole("button", { name: "＋ 今日打卡" }).click();
  await expect(
    page.getByRole("button", { name: "✓ 已完成 · 撤销打卡" }),
  ).toBeVisible();
});

test("v1 迁移保留原文，分类、备注、排序刷新后保留", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await start(page);
  await page.evaluate(
    (f) => localStorage.setItem("daily-progress:v1", JSON.stringify(f)),
    fixture,
  );
  await page.reload();
  const original = await page.evaluate(() =>
    localStorage.getItem("daily-progress:v1"),
  );
  const beforeMigration = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出升级前原始数据" }).click();
  expect(await readFile((await (await beforeMigration).path())!, "utf8")).toBe(
    original,
  );
  await page.getByRole("button", { name: "今日备注", exact: true }).click();
  await page.getByLabel("备注内容").fill("读到第三章");
  await page.getByRole("button", { name: "保存备注" }).click();
  await page.getByRole("button", { name: "＋ 今日打卡" }).click();
  await page.getByRole("button", { name: "✓ 已完成 · 撤销打卡" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "设置" })
    .click();
  await page.getByRole("button", { name: "创建分类" }).click();
  await page.getByLabel("分类名称").fill("阅读计划");
  await page.getByRole("button", { name: "保存分类" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "今天" })
    .click();
  await page.getByRole("button", { name: "编辑阅读10分钟" }).click();
  await page
    .getByLabel("分类", { exact: true })
    .selectOption({ label: "阅读计划" });
  await page.getByRole("button", { name: "保存习惯" }).click();
  await add(page, "散步");
  await page.getByRole("button", { name: "上移散步" }).click();
  await page.reload();
  await expect(page.locator(".habit-card h3").first()).toHaveText("散步");
  await page.getByLabel("按分类筛选").selectOption({ label: "阅读计划" });
  await expect(page.locator(".habit-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "上移阅读10分钟" }),
  ).toHaveCount(0);
  const saved = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    key,
  );
  expect(saved.notes[0].text).toBe("读到第三章");
  expect(saved.schemaVersion).toBe(2);
  expect(
    await page.evaluate(() => localStorage.getItem("daily-progress:v1")),
  ).toBe(original);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "设置" })
    .click();
  await page.getByRole("button", { name: "删除分类阅读计划" }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  expect(
    await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)!).habits.length,
      key,
    ),
  ).toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("周期编辑保留历史，指定星期无计划日不可打卡，历史备注独立", async ({
  page,
}) => {
  await start(page);
  await seed(page);
  await page.getByRole("button", { name: "编辑阅读10分钟" }).click();
  await page.getByLabel("重复周期").selectOption("weekdays");
  await page.getByRole("button", { name: "保存习惯" }).click();
  const saved = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    key,
  );
  expect(saved.habits[0].scheduleHistory[1].effectiveDate).toBe("2026-10-12");
  expect(saved.completionRecords).toHaveLength(6);
  await page.clock.setSystemTime(new Date("2026-10-13T10:00:00+08:00"));
  await page.clock.runFor(1100);
  await expect(
    page.getByRole("button", { name: "＋ 今日打卡" }),
  ).toBeDisabled();
  await expect(page.getByText(/今日未计划/)).toBeVisible();
  await page.getByRole("link", { name: "阅读10分钟", exact: true }).click();
  await page.getByLabel("备注日期").fill("2026-10-11");
  await page.getByLabel("备注内容").fill("今天没有计划，仍可写备注");
  await page.getByRole("button", { name: "保存备注" }).click();
  await page.reload();
  await expect(page.getByText("今天没有计划，仍可写备注")).toBeVisible();
});

test("桌面拖动排序及每日总结，JSON v2 备份保留新实体", async ({ page }) => {
  await start(page);
  await add(page, "阅读");
  await add(page, "运动");
  await page
    .locator(".habit-card")
    .first()
    .dragTo(page.locator(".habit-card").nth(1));
  await expect(page.locator(".habit-card h3").first()).toHaveText("运动");
  await page.getByRole("button", { name: "编辑当天总结" }).click();
  await page.getByLabel("备注内容").fill("完成了第一步");
  await page.getByRole("button", { name: "保存备注" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "设置" })
    .click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON 备份" }).click();
  const raw = await readFile((await (await pending).path())!, "utf8");
  expect(JSON.parse(raw).notes[0].habitId).toBeNull();
  expect(JSON.parse(raw).categories).toHaveLength(6);
  await page.getByLabel("选择JSON备份").setInputFiles({
    name: "v2.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await page.getByRole("button", { name: "确认替换并导入" }).click();
  await page.reload();
  expect(
    await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)!).notes[0].text,
      key,
    ),
  ).toBe("完成了第一步");
});
