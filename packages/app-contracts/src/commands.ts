// Device command DTOs (docs/design/contracts.md "Task, profil perangkat,
// WAN dan WiFi"). Pure TypeScript — no Node imports — so the same
// whitelist validator guards the browser contract and the engine-side
// executor. The native sanitizer (lib/api-functions.ts sanitizeTask)
// stays authoritative; this layer rejects unknown shapes BEFORE any
// task is inserted.

export type OperationState =
  | "in_progress"
  | "succeeded"
  | "failed"
  | "partial"
  | "unknown";

export type TaskName =
  | "getParameterValues"
  | "setParameterValues"
  | "refreshObject"
  | "addObject"
  | "deleteObject"
  | "download"
  | "provisions"
  | "reboot"
  | "factoryReset";

export const TASK_NAMES: readonly TaskName[] = [
  "getParameterValues",
  "setParameterValues",
  "refreshObject",
  "addObject",
  "deleteObject",
  "download",
  "provisions",
  "reboot",
  "factoryReset",
];

export const MAX_TASKS_PER_COMMAND = 100;

export interface TaskInput {
  name: TaskName;
  parameterNames?: string[];
  parameterValues?: [string, string | number | boolean, string?][];
  objectName?: string;
  fileType?: string;
  fileName?: string;
  file?: string;
  targetFileName?: string;
  expiry?: number;
  provisions?: [string, ...unknown[]][];
}

export interface DeviceCommandRequest {
  operationId: string;
  deviceId: string;
  tasks: TaskInput[];
}

export interface CommandPhase {
  name: string;
  state: OperationState;
  taskIds: string[];
  faultCode?: string;
  errorCode?: string;
}

export interface CommandOutcome {
  operationId: string;
  deviceId: string;
  state: OperationState;
  phases: CommandPhase[];
  refreshedAt?: string;
}

export interface DeviceCommandValidation {
  ok: boolean;
  errors: string[];
}

const PARAM_PATH = /^[A-Za-z0-9_.\-]+$/;

function validParamValue(
  p: unknown,
): p is [string, string | number | boolean, string?] {
  if (!Array.isArray(p) || p.length < 2) return false;
  if (typeof p[0] !== "string" || !p[0].length) return false;
  if (!["string", "boolean", "number"].includes(typeof p[1])) return false;
  if (p[2] != null && typeof p[2] !== "string") return false;
  return true;
}

function validObjectName(v: unknown): v is string {
  return typeof v === "string" && PARAM_PATH.test(v);
}

// Whitelist per task name: which fields may appear and what shape they
// take. Mirrors the native sanitizer's rules without inheriting its
// error strings.
export function validateTaskInput(task: unknown, index: number): string[] {
  const errors: string[] = [];
  if (!task || typeof task !== "object" || Array.isArray(task))
    return [`tasks[${index}]: bukan objek task`];
  const t = task as Record<string, unknown>;
  if (!TASK_NAMES.includes(t["name"] as TaskName))
    return [`tasks[${index}].name: nama task tidak dikenal`];

  const reject = (why: string): string[] => (errors.push(why), errors);

  switch (t["name"]) {
    case "getParameterValues":
      if (
        !Array.isArray(t["parameterNames"]) ||
        !t["parameterNames"].length ||
        !t["parameterNames"].every((p) => typeof p === "string" && p.length)
      )
        reject(`tasks[${index}].parameterNames: wajib daftar nama parameter`);
      break;
    case "setParameterValues":
      if (
        !Array.isArray(t["parameterValues"]) ||
        !t["parameterValues"].length ||
        !t["parameterValues"].every(validParamValue)
      )
        reject(
          `tasks[${index}].parameterValues: wajib daftar tuple [nama, nilai, tipe?]`,
        );
      break;
    case "refreshObject":
    case "deleteObject":
      if (!validObjectName(t["objectName"]))
        reject(`tasks[${index}].objectName: path objek tidak valid`);
      break;
    case "addObject":
      if (t["parameterValues"] != null) {
        if (
          !Array.isArray(t["parameterValues"]) ||
          !t["parameterValues"].every(validParamValue)
        )
          reject(
            `tasks[${index}].parameterValues: wajib daftar tuple [nama, nilai, tipe?]`,
          );
      }
      if (!validObjectName(t["objectName"]))
        reject(`tasks[${index}].objectName: path objek tidak valid`);
      break;
    case "download":
      if (!t["file"]) {
        if (typeof t["fileType"] !== "string" || !t["fileType"].length)
          reject(`tasks[${index}].fileType: wajib diisi`);
        if (typeof t["fileName"] !== "string" || !t["fileName"].length)
          reject(`tasks[${index}].fileName: wajib diisi`);
      }
      if (
        t["targetFileName"] != null &&
        typeof t["targetFileName"] !== "string"
      )
        reject(`tasks[${index}].targetFileName: harus string`);
      break;
    case "provisions":
      if (
        !Array.isArray(t["provisions"]) ||
        !t["provisions"].every(
          (arr) =>
            Array.isArray(arr) &&
            typeof arr[0] === "string" &&
            arr.every(
              (s) =>
                s == null || ["boolean", "number", "string"].includes(typeof s),
            ),
        )
      )
        reject(`tasks[${index}].provisions: format tidak valid`);
      break;
    case "reboot":
    case "factoryReset":
      break;
  }
  if (t["expiry"] != null && typeof t["expiry"] !== "number")
    reject(`tasks[${index}].expiry: harus number`);
  return errors;
}

export function validateDeviceCommandTasks(tasks: unknown): string[] {
  if (!Array.isArray(tasks)) return ["tasks: wajib array"];
  if (tasks.length === 0) return ["tasks: minimal satu task"];
  if (tasks.length > MAX_TASKS_PER_COMMAND)
    return [`tasks: maksimal ${MAX_TASKS_PER_COMMAND} task`];
  return tasks.flatMap((t, i) => validateTaskInput(t, i));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validOperationId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
