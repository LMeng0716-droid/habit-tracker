import { expect, it } from "vitest";
import { passwordError, passwordRules, passwordValid } from "./password";
it("checks 12 characters plus ASCII upper/lower/digit independently", () => {
  expect(passwordValid("NewPassword123")).toBe(true);
  for (const value of [
    "Short12",
    "lowercase123456",
    "UPPERCASE123456",
    "NoDigitsPassword",
  ])
    expect(passwordValid(value)).toBe(false);
  expect(passwordRules("abcdefghijkl").map((r) => r.met)).toEqual([
    true,
    false,
    true,
    false,
  ]);
  expect(passwordValid("中文中文中文中文Aa12")).toBe(true);
});
it("translates Supabase password errors without returning raw input", () => {
  expect(
    passwordError({ message: "Password should be at least 14 characters." }),
  ).toContain("14");
  expect(
    passwordError({ code: "weak_password", reasons: ["characters"] }),
  ).toContain("字符组合");
  expect(
    passwordError({ code: "weak_password", reasons: ["pwned"] }),
  ).toContain("泄露");
  expect(
    passwordError({ code: "weak_password", reasons: ["length"] }),
  ).toContain("长度不足");
  expect(
    passwordError({ code: "weak_password", message: "raw-user-password" }),
  ).not.toContain("raw-user-password");
  expect(passwordError({ message: "Invalid login credentials" })).toBeNull();
});
