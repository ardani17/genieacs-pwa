import { MongoClient, Collection, GridFSBucket } from "mongodb";
import { get } from "../config.ts";
import * as MongoTypes from "./types.ts";

export let filesBucket: GridFSBucket;
export let fileContentsBucket: GridFSBucket;

export const collections = {
  devices: null as Collection<MongoTypes.Device>,
  presets: null as Collection<MongoTypes.Preset>,
  objects: null as Collection<MongoTypes.Object>,
  provisions: null as Collection<MongoTypes.Provision>,
  virtualParameters: null as Collection<MongoTypes.VirtualParameter>,
  faults: null as Collection<MongoTypes.Fault>,
  tasks: null as Collection<MongoTypes.Task>,
  files: null as Collection<MongoTypes.File>,
  operations: null as Collection<MongoTypes.Operation>,
  permissions: null as Collection<MongoTypes.Permission>,
  users: null as Collection<MongoTypes.User>,
  config: null as Collection<MongoTypes.Config>,
  cache: null as Collection<MongoTypes.Cache>,
  locks: null as Collection<MongoTypes.Lock>,
  // Legacy GridFS chunks, retained for cleanup after publication through
  // lib/file-storage.ts.
  fsChunks: null as Collection<{ files_id: unknown; n: number; data: Buffer }>,
  // App-side idempotency/diagnosis store (contracts.md "app_operations");
  // never a durable work queue — holds fingerprints and outcomes only.
  appOperations: null as Collection<AppOperationDoc>,
};

export interface AppOperationDoc {
  _id: string;
  user: string;
  device: string;
  kind: string;
  fingerprint: string;
  state: "in_progress" | "succeeded" | "failed" | "partial" | "unknown";
  phases: {
    name: string;
    state: string;
    taskIds: string[];
    faultCode?: string;
    errorCode?: string;
  }[];
  // Safe, non-secret follow-up notes and the instance AddObject left
  // observable — identical across POST, replay and GET.
  warnings?: string[];
  observedInstance?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

let clientPromise: Promise<MongoClient>;

export async function connect(): Promise<void> {
  clientPromise = MongoClient.connect("" + get("MONGODB_CONNECTION_URL"));

  const client = await clientPromise;
  const db = client.db();

  collections.tasks = db.collection("tasks");
  collections.devices = db.collection("devices");
  collections.presets = db.collection("presets");
  collections.objects = db.collection("objects");
  collections.files = db.collection("fs.files");
  collections.provisions = db.collection("provisions");
  collections.virtualParameters = db.collection("virtualParameters");
  collections.faults = db.collection("faults");
  collections.operations = db.collection("operations");
  collections.permissions = db.collection("permissions");
  collections.users = db.collection("users");
  collections.config = db.collection("config");
  collections.cache = db.collection("cache");
  collections.locks = db.collection("locks");
  collections.fsChunks = db.collection("fs.chunks");
  collections.appOperations = db.collection("app_operations");
  filesBucket = new GridFSBucket(db);
  fileContentsBucket = new GridFSBucket(db, { bucketName: "file_contents" });

  await Promise.all([
    collections.tasks.createIndex({ device: 1, timestamp: 1 }),
    collections.cache.createIndex({ expire: 1 }, { expireAfterSeconds: 0 }),
    collections.locks.createIndex({ expire: 1 }, { expireAfterSeconds: 0 }),
    // Diagnosis/idempotency window only (24h TTL); _id (the operationId)
    // gives uniqueness — no durable queue is ever built on this.
    collections.appOperations.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
  ]);
}

export async function disconnect(): Promise<void> {
  if (clientPromise != null) await (await clientPromise).close();
}
