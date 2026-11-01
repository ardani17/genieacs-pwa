// Dependency-free DTO validation for the contract boundary. Values from
// the network are never cast into DTOs directly: validators check
// object/primitive/enum shapes, reject unknown keys on security inputs,
// and collect per-field errors for ApiResult.error.fieldErrors.

import type { ApiResult, ErrorCode } from "./api.ts";

const ERROR_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "BACKEND_UNAVAILABLE",
  "TIMEOUT",
  "VPN_UNAVAILABLE",
  "DEVICE_UNREACHABLE",
  "DEVICE_FAULT",
  "PARTIAL_RESULT",
  "RESULT_UNKNOWN",
  "LOGGING_DEGRADED",
  "UNSUPPORTED_PROFILE",
  "STORAGE_ERROR",
  "INTERNAL",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface FieldErrors {
  [field: string]: string;
}

export type FieldValidator<T> = (
  value: unknown,
  field: string,
  errors: FieldErrors,
) => T | undefined;

export function vString(opts: { max?: number } = {}): FieldValidator<string> {
  return (value, field, errors) => {
    if (typeof value !== "string") {
      errors[field] = "must be a string";
      return undefined;
    }
    if (opts.max !== undefined && value.length > opts.max) {
      errors[field] = `must be at most ${opts.max} characters`;
      return undefined;
    }
    return value;
  };
}

export function vNumber(
  opts: { min?: number; max?: number; integer?: boolean } = {},
): FieldValidator<number> {
  return (value, field, errors) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors[field] = "must be a number";
      return undefined;
    }
    if (opts.integer && !Number.isInteger(value)) {
      errors[field] = "must be an integer";
      return undefined;
    }
    if (opts.min !== undefined && value < opts.min) {
      errors[field] = `must be >= ${opts.min}`;
      return undefined;
    }
    if (opts.max !== undefined && value > opts.max) {
      errors[field] = `must be <= ${opts.max}`;
      return undefined;
    }
    return value;
  };
}

export function vBoolean(): FieldValidator<boolean> {
  return (value, field, errors) => {
    if (typeof value !== "boolean") {
      errors[field] = "must be a boolean";
      return undefined;
    }
    return value;
  };
}

export function vEnum<T extends string>(
  values: readonly T[],
): FieldValidator<T> {
  const allowed = new Set<string>(values);
  return (value, field, errors) => {
    if (typeof value !== "string" || !allowed.has(value)) {
      errors[field] = `must be one of: ${values.join(", ")}`;
      return undefined;
    }
    return value as T;
  };
}

// Object validator that REJECTS unknown keys — the caller decides which
// fields are security inputs, and anything undeclared is an error rather
// than silently passed through.
export function vObject<T>(fields: {
  [K in keyof T]: FieldValidator<T[K]>;
}): FieldValidator<T> {
  return (value, field, errors) => {
    if (!isRecord(value)) {
      errors[field] = "must be an object";
      return undefined;
    }
    const known = new Set(Object.keys(fields));
    for (const key of Object.keys(value))
      if (!known.has(key)) {
        errors[`${field}.${key}`] = "unknown field";
        return undefined;
      }
    const out: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(fields)) {
      const v = (validator as FieldValidator<unknown>)(
        value[key],
        `${field}.${key}`,
        errors,
      );
      if (v === undefined && !errors[`${field}.${key}`]) return undefined;
      out[key] = v;
    }
    if (Object.keys(errors).length) return undefined;
    return out as T;
  };
}

// Strict envelope assertion: throws when a value does not match the
// ApiResult contract exactly (used at the BFF boundary and in tests).
export function assertApiResult(value: unknown): void {
  if (!isRecord(value)) throw new Error("ApiResult: not an object");
  if (typeof value.requestId !== "string" || !value.requestId)
    throw new Error("ApiResult: missing requestId");
  if (value.ok === true) {
    if (!("data" in value)) throw new Error("ApiResult: missing data");
    return;
  }
  if (value.ok !== false) throw new Error("ApiResult: ok must be boolean");
  const error = value.error;
  if (!isRecord(error)) throw new Error("ApiResult: missing error object");
  if (typeof error.code !== "string" || !ERROR_CODES.has(error.code))
    throw new Error(`ApiResult: invalid error code ${String(error.code)}`);
  if (typeof error.message !== "string")
    throw new Error("ApiResult: error.message must be a string");
  if (typeof error.retryable !== "boolean")
    throw new Error("ApiResult: error.retryable must be a boolean");
  if (error.fieldErrors !== undefined) {
    if (!isRecord(error.fieldErrors))
      throw new Error("ApiResult: fieldErrors must be an object");
    for (const v of Object.values(error.fieldErrors))
      if (typeof v !== "string")
        throw new Error("ApiResult: fieldErrors values must be strings");
  }
}
