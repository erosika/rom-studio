// kit/env.test.ts: what a program started by the toolkit may see. Run: bun test kit/env
import { expect, test } from "bun:test";
import { childEnv } from "./env";

test("a child gets the named few, never the host's keys", () => {
  const host = { PATH: "/bin", HOME: "/h", LANG: "C", LC_ALL: "C", TMPDIR: "/t", ARM_GCC: "/gcc", ROM_STUDIO_GAME: "/g", JOBS: "2",
    OPENAI_API_KEY: "sk-1", ANTHROPIC_API_KEY: "sk-2", HERMES_API_KEY: "k", AWS_SECRET_ACCESS_KEY: "s", GITHUB_TOKEN: "t", SSH_AUTH_SOCK: "/s" };
  expect(childEnv({}, host)).toEqual({ PATH: "/bin", HOME: "/h", LANG: "C", LC_ALL: "C", TMPDIR: "/t", ARM_GCC: "/gcc", ROM_STUDIO_GAME: "/g", JOBS: "2" });
  expect(childEnv({ ROM: "/r.gba", PATH: "/tools:/bin", HOME: undefined }, host)).toMatchObject({ ROM: "/r.gba", PATH: "/tools:/bin" });
  expect(childEnv({ HOME: undefined }, host).HOME).toBeUndefined();
});

test("the build script starts make with the same short list", () => {
  const dir = `${import.meta.dir}/.cache/env-test-${process.pid}`, fs = require("node:fs");
  fs.mkdirSync(`${dir}/out`, { recursive: true }); fs.mkdirSync(`${dir}/data`, { recursive: true });
  fs.writeFileSync(`${dir}/Makefile`, "all:\n\t@env > seen.txt\n\t@false\n");
  const fake = `${dir}/bin`; fs.mkdirSync(fake); fs.writeFileSync(`${fake}/arm-none-eabi-gcc`, "#!/bin/sh\n"); fs.chmodSync(`${fake}/arm-none-eabi-gcc`, 0o755);
  Bun.spawnSync(["bash", `${import.meta.dir}/build.sh`, dir], { env: { PATH: `${fake}:${process.env.PATH}`, HOME: process.env.HOME ?? "", ARM_GCC: dir, OPENAI_API_KEY: "sk-not-for-make", JOBS: "1" }, stdout: "ignore", stderr: "ignore" });
  const seen = fs.readFileSync(`${dir}/seen.txt`, "utf8"); fs.rmSync(dir, { recursive: true, force: true });
  expect(seen).not.toContain("OPENAI_API_KEY"); expect(seen).toMatch(/^JOBS=1$/m); expect(seen).toMatch(/^PATH=/m);
});
