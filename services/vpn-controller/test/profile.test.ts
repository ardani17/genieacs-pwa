import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProfile, validateDesiredProfile } from "../src/profile.ts";
import { parsePppEvent } from "../src/ppp-events.ts";
const profile = {
  revision: 1,
  installationId: "11111111-1111-1111-1111-111111111111",
  server: "vpn.example.invalid",
  username: 'user " \\ # ;',
  password: 'secret " \\ # ;',
  routes: [],
  mtu: 1400,
};
void test("config credentials are quoted, private, atomic and never command arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vpn-profile-"));
  try {
    await writeProfile(
      dir,
      profile,
      "192.0.2.1",
      "11111111-1111-1111-1111-111111111111",
    );
    const options = await readFile(join(dir, "ppp-options"), "utf8");
    assert.match(options, /nodefaultroute/);
    assert.match(options, /hide-password/);
    assert.ok(options.includes('name "user \\" \\\\ # ;"'));
    assert.equal((await stat(join(dir, "ppp-options"))).mode & 0o777, 0o600);
    const config = await readFile(join(dir, "xl2tpd.conf"), "utf8");
    assert.match(config, /pass peer = no/);
    assert.match(config, /redial = no/);
    assert.equal(
      config.includes("max redials = 0"),
      false,
      "the pinned xl2tpd rejects zero rmax even when redial is disabled",
    );
    assert.equal(config.includes(profile.password), false);
    assert.throws(
      () =>
        validateDesiredProfile({ ...profile, password: "secret\nplugin evil" }),
      /INVALID_PROFILE/,
    );
    assert.throws(
      () => validateDesiredProfile({ ...profile, password: "" }),
      /INVALID_PROFILE/,
    );
    assert.throws(() =>
      parsePppEvent({
        type: "up",
        interfaceName: "eth0",
        localIp: "10.0.0.1",
        peerIp: "10.0.0.2",
        generation: "11111111-1111-1111-1111-111111111111",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
