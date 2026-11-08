import { build } from "esbuild";
import { spawn } from "node:child_process";
await build({
  entryPoints: ["services/vpn-controller/test/fixture.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  outfile: "/tmp/vpn-fixture.cjs",
});
const child = spawn(process.execPath, ["/tmp/vpn-fixture.cjs"], {
  stdio: "inherit",
  shell: false,
});
process.once("SIGTERM", () => child.kill("SIGTERM"));
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
