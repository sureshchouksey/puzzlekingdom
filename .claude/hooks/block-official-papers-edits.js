#!/usr/bin/env node
// PreToolUse hook: refuses to let Edit/Write/MultiEdit touch anything under
// docs/official-papers/ - copyrighted CSSE past papers (gitignored, never
// modified - see CLAUDE.md "Legal / data handling"). Read-only source
// material; Read is unaffected, only the write-shaped tools are blocked.
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0); // can't parse the hook payload - fail open, don't block on a hook bug
  }
  const path = data?.tool_input?.file_path || "";
  if (path.includes("docs/official-papers/")) {
    console.error(
      `Blocked: "${path}" is under docs/official-papers/ - copyrighted CSSE past papers, never edited directly. See CLAUDE.md "Legal / data handling".`
    );
    process.exit(2); // exit 2 = blocking error, reason fed back to Claude via stderr
  }
  process.exit(0);
});