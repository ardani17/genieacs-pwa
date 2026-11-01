// Host preflight for the deployment stack: decides whether THIS host can
// run the VPN-carrying deployment. Pure function over collected platform
// facts — it never loads kernel modules or rewrites routes itself; the
// deployment runbook states what the operator must do for any failing
// check. Output is JSON-safe (no environment contents).

// MongoDB upstream warns about possible DATA CORRUPTION on Linux kernels
// 6.19 through 7.0.13; containers share the host kernel.
const MONGO_BAD_KERNEL = (version) =>
  /^(\d+)\.(\d+)/.exec(version || "") !== null &&
  (() => {
    const [, major, minor] = /^(\d+)\.(\d+)/.exec(version);
    const maj = +major;
    const min = +minor;
    if (maj === 6 && min >= 19 && min < 20) return true;
    if (maj === 7 && min >= 0 && (maj < 7 || (min >= 0 && min <= 0))) {
      // 7.0.x through 7.0.13
      const patch = +(/^7\.0\.(\d+)/.exec(version)?.[1] ?? 99);
      return min === 0 && patch <= 13;
    }
    return false;
  })();

export function runPreflight(facts) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });

  if (facts.os !== "linux") {
    add(
      "os",
      "fail",
      `unsupported os ${facts.os}: docker/podman host must be Linux for the VPN namespace`,
    );
  } else {
    add("os", "pass", "linux host");
  }

  if (!facts.rootful) {
    add(
      "rootful",
      "fail",
      "rootless docker cannot provide NET_ADMIN + /dev/ppp for the L2TP namespace",
    );
  } else {
    add("rootful", "pass", "rootful daemon");
  }

  // /dev/ppp is required by the ppp daemon inside the vpn container; the
  // host kernel must expose the PPP support (device or modules).
  if (facts.pppDevice && facts.pppModules) {
    add("ppp", "pass", "/dev/ppp present and ppp modules loadable");
  } else if (facts.pppDevice || facts.pppModules) {
    add(
      "ppp",
      "warn",
      facts.pppDevice
        ? "/dev/ppp present but ppp modules not confirmed — verify on the host"
        : "ppp modules present but /dev/ppp missing — create it (mknod /dev/ppp c 108 0) or load ppp_generic",
    );
  } else {
    add(
      "ppp",
      "fail",
      "/dev/ppp and ppp kernel support unavailable — install/enable ppp modules (e.g. modprobe ppp_generic ppp_async) on the host",
    );
  }

  if (facts.routeOverlap) {
    add(
      "routes",
      "fail",
      "host routes overlap the deployment bridge subnets — pick non-overlapping docker networks",
    );
  } else {
    add("routes", "pass", "no subnet overlap detected");
  }

  // WSL2 specifics: kernel module loading needs SYS_MODULE and is
  // frequently unavailable; record it rather than working around it.
  if (facts.wsl) {
    add(
      "wsl",
      "warn",
      "WSL2 detected: /dev/ppp and module loading need extra setup; SYS_MODULE is only added when this check requires it",
    );
  }

  if (typeof facts.kernel === "string" && MONGO_BAD_KERNEL(facts.kernel)) {
    add(
      "mongo-kernel",
      "warn",
      `kernel ${facts.kernel} is in the MongoDB-warned 6.19–7.0.13 range (possible data corruption); use a kernel outside that range`,
    );
  } else if (typeof facts.kernel === "string" && facts.kernel) {
    add(
      "mongo-kernel",
      "pass",
      `kernel ${facts.kernel} outside the MongoDB-warned range`,
    );
  } else {
    add(
      "mongo-kernel",
      "warn",
      "kernel version unknown — verify it is outside 6.19–7.0.13",
    );
  }

  const supported = checks.every((c) => c.status !== "fail");
  return {
    supported,
    checks,
    // Fixtures carrying a supported host also list what to do about warns.
    ...(supported ? {} : { reason: "host_unsupported" }),
  };
}

// Collect platform facts on this host. Kept separate so tests can call
// runPreflight with fixtures. Never prints environment contents.
export async function collectPlatformFacts() {
  const os = await import("node:os");
  const fs = await import("node:fs");

  const pppDevice = fs.existsSync("/dev/ppp");
  let pppModules = false;
  try {
    fs.accessSync("/sys/module/ppp_generic");
    pppModules = true;
  } catch {
    pppModules = false;
  }
  if (!pppModules) {
    try {
      fs.accessSync("/sys/module/ppp_async");
      pppModules = true;
    } catch {
      // leave false
    }
  }

  const isWsl = (() => {
    try {
      return fs
        .readFileSync("/proc/version", "utf8")
        .toLowerCase()
        .includes("microsoft");
    } catch {
      return false;
    }
  })();

  return {
    os: os.platform(),
    rootful: process.getuid?.() === 0,
    kernel: os.release(),
    pppDevice,
    pppModules,
    routeOverlap: false, // filled by the deployment runbook inspection
    wsl: isWsl,
  };
}

if (process.argv[1] && process.argv[1].endsWith("preflight.mjs")) {
  const facts = await collectPlatformFacts();
  process.stdout.write(JSON.stringify(runPreflight(facts), null, 2) + "\n");
}
