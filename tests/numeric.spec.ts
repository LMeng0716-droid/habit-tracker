import { test, expect, type Page } from "@playwright/test";
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  timezoneId: "America/Los_Angeles",
});
const today = "2026-10-11";
const uid = "00000000-0000-0000-0000-000000000001";
type Habit = {
  id: string;
  name: string;
  emoji: string;
  habit_type: string;
  target: number;
  goal_direction: string;
  created_date: string;
  archived_on: string | null;
};
type Row = {
  event_id: string;
  revision: number;
  input_value: number;
  occurred_at: string;
  action: string;
  event_kind: string;
  habit_id: string;
  date: string;
};
async function setup(
  page: Page,
  initialTime = new Date("2026-10-11T03:00:00Z"),
) {
  await page.clock.install({ time: initialTime });
  const habits: Habit[] = [
    {
      id: "water",
      name: "喝水",
      emoji: "💧",
      habit_type: "count",
      target: 5,
      goal_direction: "at_least",
      created_date: "2026-10-01",
      archived_on: null,
    },
    {
      id: "study",
      name: "学习",
      emoji: "📚",
      habit_type: "duration",
      target: 120,
      goal_direction: "at_least",
      created_date: "2026-10-01",
      archived_on: null,
    },
  ];
  const rows: Row[] = [];
  const receipts = new Map<string, Row>();
  let writes = 0;
  let failRead = false;
  let lose = false;
  let conflict = false;
  let failWrite = false;
  let holdDate: string | null = null;
  let release: (() => void) | null = null;
  let held = false;
  const user = {
    id: uid,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const enc = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  await page.route("https://browser-check.supabase.co/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/auth/v1/token")
      return send({
        access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, aud: "authenticated", exp: 1791694800 })}.fixture-signature`,
        refresh_token: "numeric-fixture-only",
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    if (path === "/auth/v1/user") return send(user);
    if (path === "/auth/v1/logout") return send(null);
    const name = path.split("/").at(-1)!;
    const args = route.request().postDataJSON() as Record<string, unknown>;
    if (name === "read_snapshot")
      return send({ today, habits: [], checkins: [] });
    if (name.startsWith("read_") && failRead)
      return send({ message: "fixture read failure" }, 500);
    if (name === "read_snapshot_v3")
      return send({
        today,
        habits,
        checkins: [],
        progress: habits.map((h) => {
          const r = rows.filter(
            (e) =>
              e.habit_id === h.id && e.date === today && e.action !== "void",
          );
          return {
            habit_id: h.id,
            date: today,
            actual_value: r.reduce((n, e) => n + e.input_value, 0),
            event_count: r.length,
          };
        }),
      });
    if (name === "read_events_v3") {
      const result = rows
        .filter(
          (e) =>
            e.habit_id === args.p_habit_id &&
            e.date === args.p_date &&
            (!args.p_after || e.event_id > String(args.p_after)),
        )
        .sort((a, b) => a.event_id.localeCompare(b.event_id))
        .slice(0, 100)
        .map((e) => ({ ...e }));
      if (args.p_date === holdDate) {
        held = true;
        await new Promise<void>((r) => (release = r));
      }
      return send(result);
    }
    if (name === "read_summary_v3") {
      const h = habits.find((h) => h.id === args.p_habit_id)!;
      let due = 0,
        completed = 0;
      for (
        let d = new Date(`${args.p_start}T00:00:00Z`);
        d <= new Date(`${args.p_end}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const date = d.toISOString().slice(0, 10);
        if (date < h.created_date || (h.archived_on && date > h.archived_on))
          continue;
        due++;
        const actual = rows
          .filter(
            (e) =>
              e.habit_id === h.id && e.date === date && e.action !== "void",
          )
          .reduce((n, e) => n + e.input_value, 0);
        if (actual >= h.target) completed++;
      }
      return send({
        completion_rate: due
          ? Math.round((10000 * completed) / due) / 100
          : null,
        completed,
        due,
        pending: 0,
      });
    }
    if (name === "create_habit_v3") {
      writes++;
      if (
        !["🌱", "📚", "💧", "🏃", "🌙", "🎨", "🧘", "🍎", "🧹", "✨"].includes(
          String(args.p_emoji),
        )
      )
        return send({ message: "check constraint" }, 400);
      habits.push({
        id: String(args.p_id),
        name: String(args.p_name),
        emoji: String(args.p_emoji),
        habit_type: String(args.p_type),
        target: Number(args.p_target),
        created_date: today,
        archived_on: null,
        goal_direction: "at_least",
      });
      return send(habits.at(-1));
    }
    if (name === "record_progress_v3") {
      writes++;
      if (failWrite) return send({ message: "permission denied" }, 403);
      const prior = receipts.get(String(args.p_operation_id));
      if (prior) return send(prior);
      const index = rows.findIndex((e) => e.event_id === args.p_event_id);
      if (conflict) {
        conflict = false;
        if (index >= 0) {
          rows[index] = {
            ...rows[index],
            revision: rows[index].revision + 1,
            input_value: 9,
          };
        }
        return send({ message: "event_revision_conflict", code: "40001" }, 409);
      }
      if (index >= 0 && rows[index].revision !== args.p_expected_revision)
        return send({ message: "event_revision_conflict" }, 409);
      const row: Row = {
        event_id: String(args.p_event_id),
        revision: index < 0 ? 1 : rows[index].revision + 1,
        input_value: Number(args.p_value),
        occurred_at: String(args.p_occurred_at),
        action: String(args.p_action),
        event_kind: "occurrence",
        habit_id: String(args.p_habit_id),
        date: String(args.p_date),
      };
      if (index < 0) rows.push(row);
      else rows[index] = row;
      receipts.set(String(args.p_operation_id), row);
      if (lose) {
        lose = false;
        return send({ message: "response lost after commit" }, 500);
      }
      return send(row);
    }
    return send({ message: "PGRST202" }, 404);
  });
  await page.goto("./");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "💧 喝水", exact: true }),
  ).toBeVisible();
  return {
    rows,
    habits,
    writes: () => writes,
    failRead: (v: boolean) => (failRead = v),
    lose: () => (lose = true),
    conflict: () => (conflict = true),
    failWrite: (v: boolean) => (failWrite = v),
    hold: (date: string) => (holdDate = date),
    held: () => held,
    release: () => {
      holdDate = null;
      release?.();
    },
  };
}
const card = (page: Page, name = "💧 喝水") =>
  page
    .locator(".numeric-item")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
async function add(page: Page, value: string, name = "💧 喝水") {
  const c = card(page, name);
  await c.getByLabel(/新增今日记录/).fill(value);
  await c.getByRole("button", { name: "记录一次", exact: true }).click();
  await expect(
    c.getByRole("button", { name: "记录一次", exact: true }),
  ).toBeDisabled();
}

test("mobile count/duration create, independent same-day records, revise and void survive reload", async ({
  page,
}) => {
  const api = await setup(page);
  const panel = page.getByRole("region", { name: "计次和计时习惯" });
  await panel.getByLabel("名称", { exact: true }).fill("俯卧撑");
  await panel.getByRole("button", { name: "创建计次／计时习惯" }).click();
  await expect(page.getByRole("heading", { name: "🌱 俯卧撑" })).toBeVisible();
  await add(page, "2");
  await expect(
    card(page).getByText("今日累计：2 / 5 次 · 已记录 1 笔"),
  ).toBeVisible();
  await add(page, "3");
  await expect(
    card(page).getByText("今日累计：5 / 5 次 · 已记录 2 笔"),
  ).toBeVisible();
  expect(new Set(api.rows.map((e) => e.event_id)).size).toBe(2);
  await card(page).getByRole("button", { name: "查看指定日期记录" }).click();
  await expect(card(page).getByText("已加载 2 笔 · 合计 5 次")).toBeVisible();
  await expect(card(page).getByText(/截至所选日期近7天/)).toContainText("1/7");
  await expect(card(page).getByText(/截至所选日期近30天/)).toContainText(
    "1/11",
  );
  await card(page)
    .getByRole("listitem")
    .filter({ hasText: "· 2 次" })
    .getByRole("button", { name: "修改数值" })
    .click();
  await card(page).getByLabel("修改记录数值").fill("4");
  await card(page).getByRole("button", { name: "保存数值" }).click();
  await expect(
    card(page).getByText("今日累计：7 / 5 次 · 已记录 2 笔"),
  ).toBeVisible();
  page.on("dialog", (d) => void d.accept());
  await card(page)
    .getByRole("listitem")
    .filter({ hasText: "· 4 次" })
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expect(
    card(page).getByText(/今日累计：3 \/ 5 次 · 已记录 1 笔/),
  ).toBeVisible();
  await add(page, "60", "📚 学习");
  await expect(
    card(page, "📚 学习").getByText("今日累计：60 / 120 分钟 · 已记录 1 笔"),
  ).toBeVisible();
  await page.reload();
  await expect(
    card(page, "📚 学习").getByText("今日累计：60 / 120 分钟 · 已记录 1 笔"),
  ).toBeVisible();
});

test("switching history clears stale records; delayed responses cannot relabel yesterday; historical edits use the selected day", async ({
  page,
}) => {
  const api = await setup(page);
  api.rows.push({
    event_id: "00000000-0000-0000-0000-000000000099",
    habit_id: "water",
    date: "2026-10-10",
    revision: 1,
    input_value: 7,
    occurred_at: "2026-10-10T08:00:00Z",
    action: "record",
    event_kind: "occurrence",
  });
  const c = card(page);
  api.hold("2026-10-10");
  await c.getByLabel("查看记录日期").fill("2026-10-10");
  await expect.poll(api.held).toBe(true);
  await c.getByLabel("查看记录日期").fill(today);
  await expect(c.getByText("所选日期暂无记录")).toBeVisible();
  api.release();
  await expect(c.getByRole("button", { name: "修改数值" })).toHaveCount(0);
  await c.getByLabel("查看记录日期").fill("2026-10-10");
  await expect(c.getByText("16:00", { exact: false })).toBeVisible();
  await c.getByRole("button", { name: "修改数值" }).click();
  await c.getByLabel("修改记录数值").fill("8");
  await c.getByRole("button", { name: "保存数值" }).click();
  await expect(c.getByText("已加载 1 笔 · 合计 8 次")).toBeVisible();
  expect(api.rows[0].date).toBe("2026-10-10");
});

test("lost write response reconciles without resend; conflict refreshes event revision; read failure is not an empty day", async ({
  page,
}) => {
  const api = await setup(page);
  await add(page, "2");
  const c = card(page);
  await expect(c.getByText("今日累计：2 / 5 次 · 已记录 1 笔")).toBeVisible();
  await c.getByRole("button", { name: "查看指定日期记录" }).click();
  await expect(c.getByText("已加载 1 笔 · 合计 2 次")).toBeVisible();
  api.lose();
  await add(page, "3");
  await expect(page.getByRole("alert")).toContainText("已重新读取云端");
  expect(api.writes()).toBe(2);
  await expect(c.getByText("已加载 2 笔 · 合计 5 次")).toBeVisible();
  await expect(
    c.getByRole("button", { name: "记录一次", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "重新核对云端记录" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  api.conflict();
  await c.getByRole("button", { name: "修改数值" }).first().click();
  await c.getByLabel("修改记录数值").fill("4");
  await c.getByRole("button", { name: "保存数值" }).click();
  await expect(page.getByRole("alert")).toContainText("其他操作中更改");
  await expect(c.getByLabel("修改记录数值")).toHaveCount(0);
  api.failRead(true);
  await c.getByLabel("查看记录日期").fill("2026-10-09");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(c.getByText("所选日期暂无记录")).toHaveCount(0);
});

test("all event pages are available and timer saves actual whole minutes", async ({
  page,
}) => {
  const api = await setup(page);
  for (let n = 0; n < 101; n++)
    api.rows.push({
      event_id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      habit_id: "water",
      date: today,
      revision: 1,
      input_value: 1,
      occurred_at: `${today}T01:00:00Z`,
      action: "record",
      event_kind: "occurrence",
    });
  const c = card(page);
  await c.getByRole("button", { name: "查看指定日期记录" }).click();
  await expect(
    c.getByText("已加载 100 笔 · 合计 100 次（还有更多）"),
  ).toBeVisible();
  await c.getByRole("button", { name: "加载更多记录" }).click();
  await expect(c.getByText("已加载 101 笔 · 合计 101 次")).toBeVisible();
  const study = card(page, "📚 学习");
  await study.getByRole("button", { name: "开始计时" }).click();
  await page.clock.runFor(61000);
  await study.getByRole("button", { name: "结束并保存计时" }).click();
  await expect(
    study.getByText("今日累计：1 / 120 分钟 · 已记录 1 笔"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("rapid repeated submit makes one record and permission failure never looks successful", async ({
  page,
}) => {
  const api = await setup(page);
  const c = card(page);
  await c.getByLabel(/新增今日记录/).fill("1");
  await c
    .locator("form")
    .first()
    .evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  await expect(c.getByText("今日累计：1 / 5 次 · 已记录 1 笔")).toBeVisible();
  expect(api.writes()).toBe(1);
  api.failWrite(true);
  await add(page, "2");
  await expect(page.getByRole("alert")).toContainText("RLS");
  expect(api.rows).toHaveLength(1);
  await expect(c.getByText("今日累计：1 / 5 次 · 已记录 1 笔")).toBeVisible();
});

test("timer crossing Beijing midnight is saved as separate daily records", async ({
  page,
}) => {
  const api = await setup(page, new Date("2026-10-11T15:50:00.000Z"));
  const study = card(page, "📚 学习");
  await study.getByRole("button", { name: "开始计时" }).click();
  await page.clock.fastForward(1200000);
  api.lose();
  await study.getByRole("button", { name: "结束并保存计时" }).click();
  await expect(page.getByRole("alert")).toContainText("已重新读取云端");
  expect(api.rows.filter((row) => row.habit_id === "study")).toHaveLength(1);
  await page.reload();
  const restored = card(page, "📚 学习");
  await expect(
    restored.getByRole("button", { name: "结束并保存计时" }),
  ).toBeVisible();
  await restored.getByRole("button", { name: "结束并保存计时" }).click();
  await expect(
    restored.getByText("今日累计：10 / 120 分钟 · 已记录 1 笔"),
  ).toBeVisible();
  const saved = api.rows.filter((row) => row.habit_id === "study");
  expect(saved).toHaveLength(2);
  expect(saved.map((row) => row.date).sort()).toEqual([
    "2026-10-11",
    "2026-10-12",
  ]);
  expect(saved.reduce((total, row) => total + row.input_value, 0)).toBe(20);
});
test("active duration timer resumes after a full page reload", async ({
  page,
}) => {
  const api = await setup(page);
  const study = card(page, "📚 学习");
  await study.getByRole("button", { name: "开始计时" }).click();
  await page.clock.fastForward(61000);
  await page.reload();
  const restored = card(page, "📚 学习");
  await expect(restored.getByText("已计时 61 秒")).toBeVisible();
  await page.clock.fastForward(61000);
  await restored.getByRole("button", { name: "结束并保存计时" }).click();
  await expect(
    restored.getByText("今日累计：2 / 120 分钟 · 已记录 1 笔"),
  ).toBeVisible();
  expect(
    api.rows
      .filter((row) => row.habit_id === "study")
      .reduce((total, row) => total + row.input_value, 0),
  ).toBe(2);
});
