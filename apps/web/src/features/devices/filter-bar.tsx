"use client";

// Filter bar: URL is the single source of state (search/expression,
// pageSize, sort). Typing is debounced 300ms and commits via router
// replace; in-flight requests for older filters are abandoned by the
// list (AbortController keyed by serialized query).
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const urlSearch = params.get("search") ?? "";
  const expressionRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState(urlSearch);
  const [previousSearch, setPreviousSearch] = useState(urlSearch);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reconcile URL navigation before rendering the controlled field.
  if (urlSearch !== previousSearch) {
    setPreviousSearch(urlSearch);
    setSearch(urlSearch);
  }
  const queryText = params.toString();
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [queryText],
  );

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

  // The advanced filter is applied by button or by pressing Enter in
  // the field — no <form> submit is involved.
  function applyExpressionFromField(): void {
    onApplyExpression(expressionRef.current?.value ?? "");
  }

  function onExpressionKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") applyExpressionFromField();
  }

  return (
    <Card>
      <CardContent
        role="search"
        aria-label="Filter perangkat"
        className="space-y-4"
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto]">
          <div className="space-y-2">
            <Label htmlFor="device-search">Cari perangkat</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="device-search"
                type="search"
                value={search}
                placeholder="ID, serial, atau tag…"
                className="pl-10"
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-sort">Urutkan</Label>
            <Select
              value={params.get("sort") ?? "default"}
              onValueChange={(value) => {
                const next = new URLSearchParams(params.toString());
                if (value === "default") next.delete("sort");
                else next.set("sort", value);
                commit(next);
              }}
            >
              <SelectTrigger
                id="device-sort"
                className="w-full min-w-40"
                aria-label="Urutkan perangkat"
              >
                <SelectValue placeholder="Urutan khusus" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">ID: A–Z</SelectItem>
                <SelectItem value={'{"DeviceID.ID":-1}'}>ID: Z–A</SelectItem>
                <SelectItem value={'{"Events.Inform":-1}'}>
                  Inform terbaru
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="page-size">Per halaman</Label>
            <Select
              value={params.get("pageSize") ?? "25"}
              onValueChange={onPageSizeChange}
            >
              <SelectTrigger
                id="page-size"
                className="w-full min-w-24"
                aria-label="Ukuran halaman"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="min-w-0 flex-1 basis-56 space-y-2">
            <Label htmlFor="native-filter">Filter lanjutan</Label>
            <Input
              key={currentExpression}
              id="native-filter"
              name="expression"
              defaultValue={currentExpression}
              placeholder={'Contoh: DeviceID.ProductClass = "F670"'}
              aria-label="Ekspresi filter native"
              className="font-mono text-xs md:text-xs"
              ref={expressionRef}
              onKeyDown={onExpressionKeyDown}
            />
          </div>
          <Button variant="secondary" onClick={applyExpressionFromField}>
            <SlidersHorizontal aria-hidden="true" />
            Terapkan
          </Button>
          {currentExpression || search ? (
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                setSearch("");
                const next = new URLSearchParams(params.toString());
                next.delete("filter");
                next.delete("search");
                commit(next);
              }}
            >
              Hapus filter
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
