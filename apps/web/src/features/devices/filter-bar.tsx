"use client";

// Filter bar: URL is the single source of state (search/expression,
// pageSize, sort). Typing is debounced 300ms and commits via router
// replace; in-flight requests for older filters are abandoned by the
// list (AbortController keyed by serialized query).
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(next: URLSearchParams) {
    // Filter changes reset the page (handled by the backend adapter too).
    if (next.has("page")) next.delete("page");
    router.replace(`/devices?${next.toString()}`, { scroll: false });
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("search", value);
      else next.delete("search");
      commit(next);
    }, 300);
  }

  function onPageSizeChange(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("pageSize", value);
    commit(next);
  }

  function onApplyExpression(expression: string) {
    const next = new URLSearchParams(params.toString());
    if (expression.trim()) next.set("filter", expression.trim());
    else next.delete("filter");
    commit(next);
  }

  const currentExpression = params.get("filter") ?? "";

  return (
    <div
      role="search"
      aria-label="Filter perangkat"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-8)",
        alignItems: "flex-end",
      }}
    >
      <label>
        <span className="sr-only" style={{ position: "absolute", left: -9999 }}>
          Cari perangkat
        </span>
        <input
          type="search"
          value={search}
          placeholder="Cari ID / serial / tag…"
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            minHeight: "var(--touch-target)",
            padding: "var(--space-8)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--color-border)",
            minWidth: "14rem",
          }}
        />
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = (
            e.currentTarget.elements.namedItem("expression") as HTMLInputElement
          ).value;
          onApplyExpression(value);
        }}
      >
        <input
          name="expression"
          defaultValue={currentExpression}
          placeholder={'Ekspresi native (mis. _tags = "online")'}
          aria-label="Ekspresi filter native"
          style={{
            minHeight: "var(--touch-target)",
            padding: "var(--space-8)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--color-border)",
            minWidth: "16rem",
          }}
        />
        <Button type="submit" variant="secondary">
          Terapkan
        </Button>
      </form>
      <label>
        <span style={{ color: "var(--color-muted)" }}>Halaman ukur</span>
        <select
          value={params.get("pageSize") ?? "25"}
          onChange={(e) => onPageSizeChange(e.target.value)}
          aria-label="Ukuran halaman"
          style={{
            minHeight: "var(--touch-target)",
            borderRadius: "var(--radius)",
          }}
        >
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
    </div>
  );
}
