import { test, expect, type Page } from "@playwright/test";
import type { Snapshot } from "../src/domain";
// Browser API fixtures exercise the real SDK, not real Supabase JWT verification.
const uid = "00000000-0000-0000-0000-000000000001";
const now = new Date("2026-10-11T03:00:00Z");
const today = "2026-10-11";
function fixture(): Snapshot {
  return {
    today,
    habits: [
      {
        id: "reading",
        name: "阅读",
        color: 0,
        created_date: "2026-10-01",
        archived_on: null,
      },
    ],
    checkins: [
      { habit_id: "reading", date: "2026-10-09" },
      { habit_id: "reading", date: "2026-10-10" },
    ],
  };
}
async function backend(page: Page, snapshot = fixture()) {
  await page.clock.install({ time: now });
  const user = {
    id: uid,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: now.toISOString(),
  };
  const encode = (data: unknown) =>
    Buffer.from(JSON.stringify(data)).toString("base64url");
  const tokenFor = (id: string) =>
    `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, aud: "authenticated", exp: Math.floor(now.getTime() / 1000) + 3600 })}.fixture-signature`;
  const token = tokenFor(uid);
  let release: (() => void) | null = null;
  let holdNext = false;
  let failRead = false,
    failWrite = false,
    reads = 0,
    writes = 0;
  await page.route("https://habit-browser.invalid/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    if (path === "/auth/v1/token") {
      const args = request.postDataJSON() as {
        password: string;
        email: string;
      };
      if (args.password === "wrongpass")
        return respond(
          {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          },
          400,
        );
      return respond({
        access_token: tokenFor(
          args.email === "other@example.test"
            ? "00000000-0000-0000-0000-000000000002"
            : uid,
        ),
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "fixture-refresh-token",
        user: {
          ...user,
          id:
            args.email === "other@example.test"
              ? "00000000-0000-0000-0000-000000000002"
              : uid,
          email: args.email,
        },
      });
    }
    if (path === "/auth/v1/user") return respond({ user, ...user });
    if (path === "/auth/v1/signup") return respond({ user, session: null });
    if (path === "/auth/v1/recover") return respond({});
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204 });
    if (path === "/rest/v1/rpc/read_snapshot") {
      reads++;
      expect(request.headers()["content-profile"]).toBe("habit_mobile");
      if (failRead)
        return respond({ message: "fixture read failure", code: "XX000" }, 500);
      const subject = JSON.parse(
        Buffer.from(
          request.headers().authorization.split(".")[1],
          "base64url",
        ).toString(),
      ).sub;
      const response = structuredClone(
        subject === uid ? snapshot : { today, habits: [], checkins: [] },
      );
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return respond(response);
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      writes++;
      if (failWrite)
        return respond(
          { message: "fixture write failure", code: "XX000" },
          500,
        );
      const args = request.postDataJSON() as Record<
        string,
        string | number | boolean
      >;
      const rpc = path.split("/").at(-1);
      if (
        rpc === "create_habit" &&
        !snapshot.habits.some((h) => h.id === args.p_id)
      )
        snapshot.habits.push({
          id: String(args.p_id),
          name: String(args.p_name),
          color: Number(args.p_color),
          created_date: today,
          archived_on: null,
        });
      if (rpc === "edit_habit") {
        const habit = snapshot.habits.find((h) => h.id === args.p_id)!;
        habit.name = String(args.p_name);
        habit.color = Number(args.p_color);
      }
      if (rpc === "archive_habit")
        snapshot.habits.find((h) => h.id === args.p_id)!.archived_on = today;
      if (rpc === "set_checkin") {
        snapshot.checkins = snapshot.checkins.filter(
          (c) => !(c.habit_id === args.p_habit_id && c.date === args.p_date),
        );
        if (args.p_completed)
          snapshot.checkins.push({
            habit_id: String(args.p_habit_id),
            date: String(args.p_date),
          });
      }
      return respond(null);
    }
    throw new Error(`Unhandled fixture endpoint ${path}`);
  });
  return {
    snapshot,
    token,
    holdRead: () => {
      holdNext = true;
    },
    releaseRead: () => {
      release?.();
    },
    failRead: (value: boolean) => {
      failRead = value;
    },
    failWrite: (value: boolean) => {
      failWrite = value;
    },
    reads: () => reads,
    writes: () => writes,
  };
}
async function login(page: Page, password = "password123") {
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
test("login, daily checkin/cancel and clear-browser recovery from cloud", async ({
  page,
}) => {
  const api = await backend(page);
  await page.goto("/habit-tracker/");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打卡", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消打卡", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "取消打卡", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消打卡", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打卡", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "账号", exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await login(page);
  await page.getByRole("button", { name: "查看历史" }).click();
  await expect(
    page.getByRole("button", { name: "2026-10-09 已打卡" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(api.snapshot.checkins).toHaveLength(2);
});
test("create, edit, historical checkin and archive preserves today's completion", async ({
  page,
}) => {
  await backend(page);
  await page.goto("/habit-tracker/");
  await login(page);
  await page.getByRole("button", { name: "创建习惯", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("运动");
  await page.getByRole("button", { name: "保存习惯" }).click();
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "运动", exact: true }) });
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("运动十分钟");
  await page.getByRole("button", { name: "保存习惯" }).click();
  const updated = page.locator("article").filter({
    has: page.getByRole("heading", { name: "运动十分钟", exact: true }),
  });
  await updated.getByRole("button", { name: "打卡", exact: true }).click();
  await updated.getByRole("button", { name: "查看历史" }).click();
  await expect(
    page.getByRole("button", { name: "2026-10-11 已打卡" }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "归档习惯" }).click();
  await expect(
    page.getByText("已于 2026-10-11 归档，历史记录只读。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2026-10-11 已打卡" }),
  ).toBeDisabled();
});
test("historical dates, denominator and streak", async ({ page }) => {
  await backend(page);
  await page.goto("/habit-tracker/");
  await login(page);
  await page.getByRole("button", { name: "查看历史" }).click();
  await expect(page.getByText("当前连续 2 天 · 最长连续 2 天")).toBeVisible();
  await expect(page.getByText("本月 2/11 天 · 完成率 18%")).toBeVisible();
  await page.getByRole("button", { name: "2026-10-08 未打卡" }).click();
  await expect(page.getByText("当前连续 3 天 · 最长连续 3 天")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2026-10-12 未打卡" }),
  ).toBeDisabled();
});
test("failed writes retain input and require refreshing before retry", async ({
  page,
}) => {
  const api = await backend(page);
  await page.goto("/habit-tracker/");
  await login(page);
  await page.getByRole("button", { name: "创建习惯", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("失败后重试");
  api.failWrite(true);
  await page.getByRole("button", { name: "保存习惯" }).click();
  await expect(page.getByRole("alert")).toContainText("保存结果可能尚未确认");
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
    "失败后重试",
  );
  await expect(page.getByRole("button", { name: "保存习惯" })).toBeDisabled();
  api.failWrite(false);
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "保存习惯" }).click();
  await expect(
    page.getByRole("heading", { name: "失败后重试", exact: true }),
  ).toBeVisible();
});
test("failed reads are not empty accounts; no horizontal overflow", async ({
  page,
}) => {
  const api = await backend(page);
  api.failRead(true);
  await page.goto("/habit-tracker/");
  await login(page);
  await expect(page.getByRole("alert")).toContainText("读取失败");
  await expect(
    page.getByRole("button", { name: "创建习惯", exact: true }),
  ).toHaveCount(0);
  api.failRead(false);
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("legacy localStorage is ignored; signup and reset email flows", async ({
  page,
}) => {
  await backend(page, { today, habits: [], checkins: [] });
  await page.addInitScript(() =>
    localStorage.setItem(
      "daily-progress:v2",
      JSON.stringify({ habits: [{ name: "旧电脑数据" }] }),
    ),
  );
  await page.goto("/habit-tracker/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("验证邮件");
  await page.getByRole("button", { name: "忘记密码", exact: true }).click();
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByRole("status")).toContainText("密码重置邮件");
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await login(page);
  await expect(page.getByText("今天还没有进行中的习惯。")).toBeVisible();
  await expect(page.getByText("旧电脑数据")).toHaveCount(0);
});

test("wrong password stays signed out; another account cannot see old or delayed data", async ({
  page,
}) => {
  const api = await backend(page);
  await page.goto("/habit-tracker/");
  await login(page, "wrongpass");
  await expect(page.getByRole("alert")).toContainText("邮箱或密码不正确");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
  const before = api.reads();
  api.holdRead();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(() => api.reads()).toBeGreaterThan(before);
  await page.getByRole("button", { name: "账号", exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("other@example.test");
  await page.getByLabel("密码", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("今天还没有进行中的习惯。")).toBeVisible();
  api.releaseRead();
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toHaveCount(0);
});
test("password recovery callback shows new-password form", async ({ page }) => {
  const api = await backend(page);
  await page.goto(
    `/habit-tracker/#access_token=${api.token}&refresh_token=fixture-refresh-token&token_type=bearer&expires_in=3600&type=recovery`,
  );
  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill("updatedpassword123");
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
});
