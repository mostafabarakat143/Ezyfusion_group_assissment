import { spawnSync } from "node:child_process";

const zones = ["UTC", "Asia/Kuala_Lumpur", "America/New_York"];
let failed = false;

for (const timeZone of zones) {
  console.log(`\n=== billing tests TZ=${timeZone} ===\n`);
  const result = spawnSync(
    "npx",
    ["vitest", "run", "src/lib/billing.test.ts"],
    {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, TZ: timeZone },
    },
  );
  if (result.status !== 0) {
    failed = true;
    console.error(
      `Billing tests failed for TZ=${timeZone} (exit ${result.status ?? "unknown"})`,
    );
  }
}

if (failed) {
  process.exit(1);
}
