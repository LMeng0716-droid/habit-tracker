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
  const tokenFor = (id: string, sessionNumber = 0) =>
    `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, session_number: sessionNumber, aud: "authenticated", exp: Math.floor(now.getTime() / 1000) + 3600 })}.fixture-signature`;
  const token = tokenFor(uid);
  let release: (() => void) | null = null;
  let holdNext = false;
  let holdNextLogout = false;
  let releaseLogout: (() => void) | null = null;
  let logoutRequests = 0;
  let issuedSessions = 0;
  let serverPasswordError = false;
  let signupRequests = 0;
  let failRead = false,
    failWrite = false,
    reads = 0,
    writes = 0;
  await page.route("https://browser-check.supabase.co/**", async (route) => {
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
      issuedSessions++;
      return respond({
        access_token: tokenFor(
          args.email === "other@example.test"
            ? "00000000-0000-0000-0000-000000000002"
            : uid,
          issuedSessions,
        ),
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: `fixture-refresh-token-${issuedSessions}`,
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
    if (path === "/auth/v1/signup" || path === "/auth/v1/recover") {
      expect(new URL(request.url()).searchParams.get("redirect_to")).toBe(
        new URL("./", page.url()).href,
      );
      if (path.endsWith("signup")) {
        signupRequests++;
        if (serverPasswordError)
          return respond(
            {
              error_code: "weak_password",
              msg: "Password should be at least 16 characters.",
              weak_password: { reasons: ["length"] },
            },
            422,
          );
      }
      return respond(path.endsWith("signup") ? { user, session: null } : {});
    }
    if (path === "/auth/v1/logout") {
      logoutRequests++;
      if (holdNextLogout) {
        holdNextLogout = false;
        await new Promise<void>((resolve) => {
          releaseLogout = resolve;
        });
      }
      return route.fulfill({ status: 204 });
    }
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
    holdLogout: () => {
      holdNextLogout = true;
    },
    releaseLogout: () => {
      releaseLogout?.();
      releaseLogout = null;
    },
    logoutRequests: () => logoutRequests,
    signupRequests: () => signupRequests,
    serverPasswordError: () => {
      serverPasswordError = true;
    },
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
test("login, daily checkin/cancel and logout recovery from cloud", async ({
  page,
}) => {
  const api = await backend(page);
  await page.goto("./");
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
  await page.reload();
  await login(page);
  await page.getByText("更多操作", { exact: true }).click();
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
  await page.goto("./");
  await login(page);
  await page.getByRole("button", { name: "创建习惯", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("运动");
  await page.getByRole("button", { name: "保存习惯" }).click();
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "运动", exact: true }) });
  await card.getByText("更多操作", { exact: true }).click();
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("运动十分钟");
  await page.getByRole("button", { name: "保存习惯" }).click();
  const updated = page.locator("article").filter({
    has: page.getByRole("heading", { name: "运动十分钟", exact: true }),
  });
  await updated.getByRole("button", { name: "打卡", exact: true }).click();
  if (!(await updated.getByRole("button", { name: "查看历史" }).isVisible()))
    await updated.getByText("更多操作", { exact: true }).click();
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
  await page.goto("./");
  await login(page);
  await page.getByText("更多操作", { exact: true }).click();
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
  await page.goto("./");
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
  await page.goto("./");
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
  await page.goto("./");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("NewPassword123");
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
  await page.goto("./");
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
    `./#access_token=${api.token}&refresh_token=fixture-refresh-token&token_type=bearer&expires_in=3600&type=recovery`,
  );
  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill("UpdatedPassword123");
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
});

test("preview auth never reads or removes production session and legacy business keys", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "preview",
    "Preview-specific same-origin storage check",
  );
  const api = await backend(page);
  await page.goto("./");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
  const previewKey = "habit-tracker-preview:browser-check.supabase.co:auth";
  const productionKey = "sb-browser-check-auth-token";
  const readStorage = () =>
    page.evaluate(
      ({ previewKey, productionKey }) => ({
        preview: localStorage.getItem(previewKey),
        production: localStorage.getItem(productionKey),
        v1: localStorage.getItem("daily-progress:v1"),
        v2: localStorage.getItem("daily-progress:v2"),
      }),
      { previewKey, productionKey },
    );
  const session = (await readStorage()).preview;
  expect(session).toBeTruthy();
  // Wait for the first SDK signOut to finish before touching fixtures/reloading.
  await page.getByRole("button", { name: "账号", exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect((await readStorage()).preview).toBeNull();
  // Do not manually remove preview storage: that would hide logout failures.
  await page.evaluate(
    ({ productionKey, session }) => {
      localStorage.setItem(productionKey, session!);
      localStorage.setItem("daily-progress:v1", "legacy-one");
      localStorage.setItem("daily-progress:v2", "legacy-two");
    },
    { productionKey, session },
  );
  const signedOut = {
    preview: null,
    production: session,
    v1: "legacy-one",
    v2: "legacy-two",
  };
  expect(await readStorage()).toEqual(signedOut);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect(await readStorage()).toEqual(signedOut); // no automatic production import
  await login(page);
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
  expect(await readStorage()).toMatchObject({
    production: session,
    v1: "legacy-one",
    v2: "legacy-two",
  });
  expect((await readStorage()).preview).toBeTruthy();
  expect((await readStorage()).preview).not.toBe(session); // genuinely new simulated session
  const beforeLogout = api.logoutRequests();
  api.holdLogout();
  try {
    await page.getByRole("button", { name: "账号", exact: true }).click();
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect.poll(() => api.logoutRequests()).toBe(beforeLogout + 1);
    // Deterministic reproduction: SDK still holds its own session while the
    // revocation response is pending. The old immediate null assertion fails here.
    expect((await readStorage()).preview).not.toBeNull();
    expect(await readStorage()).toMatchObject({
      production: session,
      v1: "legacy-one",
      v2: "legacy-two",
    });
  } finally {
    api.releaseLogout();
  }
  // SIGNED_OUT is emitted AFTER _removeSession clears SDK-owned keys.
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect(await readStorage()).toEqual(signedOut); // exact original invariant
  await page.reload();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect(await readStorage()).toEqual(signedOut); // no post-logout restoration
});

test("production keeps the original Supabase project auth key", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "production",
    "Production-specific default-key check",
  );
  await backend(page);
  await page.goto("./");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("sb-browser-check-auth-token"),
    ),
  ).toBeTruthy();
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        "habit-tracker-preview:browser-check.supabase.co:auth",
      ),
    ),
  ).toBeNull();
});

test("signup password checklist validates before sending; server policy is translated", async ({
  page,
}) => {
  const api = await backend(page);
  await page.goto("./");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("lowercase123456");
  await expect(page.getByRole("list", { name: "密码规则" })).toContainText(
    "未满足：包含大写英文字母",
  );
  await expect(
    page.getByRole("button", { name: "注册", exact: true }),
  ).toBeDisabled();
  await page
    .locator("form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.getByRole("alert")).toContainText("请先满足密码规则");
  expect(api.signupRequests()).toBe(0);
  await page.getByLabel("密码", { exact: true }).fill("NewPassword123");
  await expect(
    page.getByRole("button", { name: "注册", exact: true }),
  ).toBeEnabled();
  api.serverPasswordError();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("至少 16 个字符");
});
test("existing short-password account can still log in", async ({ page }) => {
  await backend(page);
  await page.goto("./");
  await login(page, "old123");
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
});
test("PWA manifest/icons stay scoped and no Service Worker is registered", async ({
  page,
  context,
}, info) => {
  await backend(page);
  await page.goto("./");
  const base = new URL(info.project.use.baseURL!).pathname;
  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestHref).toBe(`${base}manifest.webmanifest`);
  const response = await page.request.get(
    new URL(manifestHref!, page.url()).href,
  );
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe("每日进步");
  expect(manifest.scope).toBe(base);
  expect(manifest.id).toBe(base);
  expect(manifest.start_url).toBe(base);
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    const result = await page.request.get(new URL(icon.src, page.url()).href);
    expect(result.ok()).toBe(true);
    const png = await result.body();
    const size = Number(icon.sizes.split("x")[0]);
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }
  const apple = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  expect(apple).toBe(`${base}icons/apple-touch-icon.png?v=sprout-2`);
  const appleResponse = await page.request.get(
    new URL(apple!, page.url()).href,
  );
  expect((await appleResponse.body()).readUInt32BE(16)).toBe(180);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
  await login(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "阅读", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("alert")).toContainText("没有离线待同步队列");
  await expect(
    page.getByRole("button", { name: "打卡", exact: true }),
  ).toBeDisabled();
  await context.setOffline(false);
});
test("failed app module has a manual recovery entry instead of an empty page", async ({
  page,
}) => {
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "每日进步暂时未能加载" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "联网重新加载" }),
  ).toBeVisible();
});

for (const deadline of ["idle", "absolute"] as const)
  test(`session survives reload and expires at ${deadline} boundary`, async ({
    page,
  }) => {
    await backend(page);
    await page.goto("./");
    await login(page);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "阅读", exact: true }),
    ).toBeVisible();
    await page.evaluate((deadline) => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (
          key.endsWith(":session-policy") &&
          key.includes(location.pathname)
        ) {
          const value = JSON.parse(localStorage.getItem(key)!);
          value.loginAt =
            Date.now() - (deadline === "idle" ? 8 : 30) * 86400000;
          value.lastActiveAt =
            Date.now() - (deadline === "idle" ? 7 : 0) * 86400000;
          localStorage.setItem(key, JSON.stringify(value));
        }
      }
    }, deadline);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("为了保护你的账号安全，请重新登录。"),
    ).toBeVisible();
    await login(page);
    await expect(
      page.getByRole("heading", { name: "阅读", exact: true }),
    ).toBeVisible();
  });
