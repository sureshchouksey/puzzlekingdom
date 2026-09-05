#!/usr/bin/env node
// PostToolUse hook: after any Edit/Write/MultiEdit touching a .ts/.tsx file,
// typecheck the owning workspace (apps/api or apps/web) with --noEmit, so a
// type error surfaces immediately rather than at the next build. Read-only
// check - never emits build output, regardless of what each tsconfig.json
// itself says.
const { execSync } = require("node:child_process");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const path = data?.tool_input?.file_path || "";
  if (!/\.tsx?$/.test(path)) process.exit(0);

  let cwd;
  if (path.includes("apps/api/")) cwd = "apps/api";
  else if (path.includes("apps/web/")) cwd = "apps/web";
  else process.exit(0); // not inside either workspace - nothing to typecheck against

  try {
    execSync("npx tsc --noEmit -p tsconfig.json", { cwd, stdio: "pipe" });
    process.exit(0);
  } catch (err) {
    console.error(
      `Typecheck failed in ${cwd} after editing ${path}:\n${err.stdout}${err.stderr}`
    );
    process.exit(2); // exit 2 = shown to Claude as feedback, so it can self-correct
  }
});