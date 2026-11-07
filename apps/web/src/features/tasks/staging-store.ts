"use client";

// In-memory task staging (M05-D): stage → review → commit. Deliberately
// NOT persisted to browser storage — logout/close drops staged work and
// secrets never survive the tab. Max 100 entries; a second entry for
// the same WAN target conflicts until the first is removed. Summaries
// shown in the UI come from the masked fields only.

import type { TaskInput } from "../../../../../packages/app-contracts/src/commands.ts";

export const STAGING_MAX_ENTRIES = 100;

export interface WanTarget {
  collection: string;
  instance: string | null;
}

export interface StagedEntry {
  id: string;
  deviceId: string;
  kind: "command" | "wan";
  // Masked, human-readable summary parts — never contain passwords.
  summary: {
    action: string;
    detail?: string;
  };
  tasks: TaskInput[];
  wanTarget?: WanTarget;
  wanSettings?: Record<string, unknown>;
  destructive: boolean;
  stagedAt: number;
}

export type StageResult =
  | { ok: true; entry: StagedEntry }
  | { ok: false; reason: "full" | "wan-conflict"; conflictWith?: string };

export class StagingStore {
  private entries: StagedEntry[] = [];
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  list(): readonly StagedEntry[] {
    return this.entries;
  }

  stage(input: Omit<StagedEntry, "id" | "stagedAt">): StageResult {
    if (this.entries.length >= STAGING_MAX_ENTRIES)
      return { ok: false, reason: "full" };
    if (
      input.kind === "wan" &&
      input.wanTarget &&
      this.entries.some(
        (e) =>
          e.kind === "wan" &&
          e.deviceId === input.deviceId &&
          e.wanTarget?.collection === input.wanTarget.collection &&
          e.wanTarget?.instance === input.wanTarget.instance,
      )
    ) {
      const conflict = this.entries.find(
        (e) =>
          e.kind === "wan" &&
          e.deviceId === input.deviceId &&
          e.wanTarget?.collection === input.wanTarget.collection &&
          e.wanTarget?.instance === input.wanTarget.instance,
      );
      return { ok: false, reason: "wan-conflict", conflictWith: conflict?.id };
    }
    const entry: StagedEntry = {
      ...input,
      id: crypto.randomUUID(),
      stagedAt: Date.now(),
    };
    this.entries = [...this.entries, entry];
    this.emit();
    return { ok: true, entry };
  }

  remove(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
  }

  // Dropping staged state also clears every secret still held in form
  // payloads — nothing survives logout or target switch.
  clear(): void {
    this.entries = [];
    this.emit();
  }
}

// One store per tab (memory only).
let store: StagingStore | null = null;

export function stagingStore(): StagingStore {
  if (!store) store = new StagingStore();
  return store;
}
