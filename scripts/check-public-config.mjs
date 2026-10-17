import { loadEnv } from "vite";
import { validatePublicConfig } from "../src/public-config.ts";
try {
  const result = validatePublicConfig(
    loadEnv("production", process.cwd(), "VITE_"),
  );
  if (!result.ok) {
    console.error("Supabase 公开配置校验失败：\n" + result.issues.join("\n"));
    process.exitCode = 1;
  } else console.log("Supabase 公开配置格式校验通过（未连接或验证远程项目）。");
} catch {
  console.error(
    "公开配置校验未完成，请检查环境文件和运行环境；未开始前端构建。",
  );
  process.exitCode = 1;
}
