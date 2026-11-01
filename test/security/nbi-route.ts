import test from "node:test";
import assert from "node:assert/strict";
import { listener } from "../../lib/nbi.ts";
import * as engineServer from "../../lib/server.ts";
import { collections } from "../../lib/db/db.ts";

// Loopback route integration with fake collection spies: rejected queries
// must never reach find/countDocuments; valid ones pass the validated
// filter with the time budget and default limit applied.

interface RecordedFind {
  filter: unknown;
  options: unknown;
}

function fakeCollection(rows: unknown[]): {
  state: {
    findCalls: RecordedFind[];
    countCalls: { filter: unknown; options: unknown }[];
    limitArg: number | undefined;
    skipArg: number | undefined;
    sortArg: unknown;
  };
  collection: {
    find: (filter: unknown, options: unknown) => unknown;
    countDocuments: (filter: unknown, options: unknown) => Promise<number>;
  };
} {
  const state = {
    findCalls: [] as RecordedFind[],
    countCalls: [] as { filter: unknown; options: unknown }[],
    limitArg: undefined as number | undefined,
    skipArg: undefined as number | undefined,
    sortArg: undefined as unknown,
  };

  const cursor: Record<string, unknown> = {
    sort: (s: unknown) => {
      state.sortArg = s;
      return cursor;
    },
    skip: (n: number) => {
      state.skipArg = n;
      return cursor;
    },
    limit: (n: number) => {
      state.limitArg = n;
      return cursor;
    },
    [Symbol.asyncIterator]: async function* () {
      for (const row of rows) yield row;
    },
  };

  return {
    state,
    collection: {
      find: (filter: unknown, options: unknown) => {
        state.findCalls.push({ filter, options });
        return cursor;
      },
      countDocuments: async (filter: unknown, options: unknown) => {
        state.countCalls.push({ filter, options });
        return rows.length;
      },
    },
  };
}

const PORT = 8934;

async function startServer(): Promise<string> {
  engineServer.start(
    { port: PORT, host: "127.0.0.1", ssl: null, timeout: 15000 },
    async (req, res) => listener(req, res),
  );
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 50; ++i) {
    try {
      // Probe with a path no collection answers: any HTTP status proves
      // the server is up without touching the fake collections.
      const probe = await fetch(`${base}/__probe__`, {
        signal: AbortSignal.timeout(2000),
      });
      if (probe.status === 404) return base;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("NBI test server did not start");
}

void test("rejected queries never reach the driver", async () => {
  const fake = fakeCollection([]);
  (collections as Record<string, unknown>)["devices"] = fake.collection;
  const base = await startServer();
  try {
    for (const bad of [
      "?query=" + encodeURIComponent('{"$where":"return true"}'),
      "?query=" + encodeURIComponent("[1,2]"),
      "?query=" + encodeURIComponent('{"__proto__":{"x":1}}'),
      "?sort=" + encodeURIComponent('{"a":2}'),
      "?limit=99999999",
    ]) {
      const res = await fetch(`${base}/devices${bad}`);
      assert.equal(res.status, 400, `expected 400 for ${bad}`);
    }
    assert.equal(fake.state.findCalls.length, 0, "find must not be called");
    assert.equal(fake.state.countCalls.length, 0, "count must not be called");
  } finally {
    await engineServer.stop();
  }
});

void test("valid listing passes validated filter, budget and default limit", async () => {
  const fake = fakeCollection([{ _id: "dev-1" }, { _id: "dev-2" }]);
  (collections as Record<string, unknown>)["tasks"] = fake.collection;
  const base = await startServer();
  try {
    const res = await fetch(
      `${base}/tasks?query=${encodeURIComponent('{"retries":{"$gte":1}}')}&limit=2`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("total"), "2");
    const body = await res.json();
    assert.equal(body.length, 2);

    assert.equal(fake.state.findCalls.length, 1);
    assert.deepEqual(fake.state.findCalls[0].filter, { retries: { $gte: 1 } });
    assert.deepEqual(fake.state.findCalls[0].options, {
      projection: null,
      maxTimeMS: 5000,
    });
    assert.deepEqual(fake.state.countCalls[0].options, { maxTimeMS: 5000 });
    assert.equal(fake.state.limitArg, 2);

    // HEAD carries the total without a body.
    const head = await fetch(`${base}/tasks`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("total"), "2");
    assert.equal(await head.text(), "");

    // Absent limit now caps at the documented default.
    const defaulted = fakeCollection([]);
    (collections as Record<string, unknown>)["faults"] = defaulted.collection;
    const res2 = await fetch(`${base}/faults`);
    await res2.text();
    assert.equal(defaulted.state.limitArg, 10000);
  } finally {
    await engineServer.stop();
  }
});

void test("unknown collections stay 404 without touching the driver", async () => {
  const fake = fakeCollection([]);
  (collections as Record<string, unknown>)["devices"] = fake.collection;
  const base = await startServer();
  try {
    // "constructor" must not resolve through the collections prototype.
    const res = await fetch(`${base}/constructor`);
    assert.equal(res.status, 404);
    assert.equal(fake.state.findCalls.length, 0);
  } finally {
    await engineServer.stop();
  }
});
