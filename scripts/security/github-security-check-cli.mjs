import { runGithubSecurityCheck } from "./github-security-check.mjs";

runGithubSecurityCheck().catch(() => {
  process.stderr.write(
    "SECURITY_EVIDENCE_BLOCKED: checkout, policy, API or evidence unavailable\n",
  );
  process.exitCode = 1;
});
