import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Field } from "./field";
import { Status } from "./status";
import { Textarea } from "./textarea";
import { DataView } from "./data-view";

test("dialog traps focus and closes on Escape", async () => {
  const user = userEvent.setup();
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>Buka</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Konfirmasi</DialogTitle>
          <DialogDescription>Periksa sebelum menyimpan.</DialogDescription>
          <button>Batal</button>
          <button>Simpan</button>
        </DialogContent>
      </Dialog>
    );
  }
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Buka" });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "Konfirmasi" })).toHaveAttribute(
    "aria-modal",
    "true",
  );
  expect(screen.getByRole("button", { name: "Batal" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Tutup" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Batal" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("button variants, disabled and busy semantics", () => {
  render(
    <>
      <Button>Simpan</Button>
      <Button variant="secondary">Batal</Button>
      <Button variant="destructive">Hapus</Button>
      <Button disabled>Terkunci</Button>
      <Button busy>Simpan</Button>
    </>,
  );
  expect(screen.getByRole("button", { name: "Simpan" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Terkunci" })).toBeDisabled();
  const busy = screen.getByRole("button", { name: "Memproses…" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
});

test("field wires label, error and aria-describedby", () => {
  render(
    <Field label="Nama perangkat" required error="Wajib diisi">
      {({ id, describedBy, errorClass }) => (
        <input id={id} aria-describedby={describedBy} className={errorClass} />
      )}
    </Field>,
  );
  const label = screen.getByText("Nama perangkat *");
  const input = screen.getByLabelText("Nama perangkat *");
  expect(input).toHaveAccessibleDescription("Wajib diisi");
  expect(label).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Wajib diisi");
});

test("status announces politely with icon and text", () => {
  render(<Status tone="success">Terhubung</Status>);
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(status).toHaveTextContent("Terhubung");
  expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

test("dataView states are explicit: loading busy, empty CTA, error requestId", () => {
  const { rerender } = render(
    <DataView state="loading" items={[]} renderReady={() => null} />,
  );
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");

  rerender(
    <DataView
      state="empty"
      items={[]}
      emptyAction={<Button>Tambah perangkat</Button>}
      renderReady={() => null}
    />,
  );
  expect(screen.getByText("Belum ada data.")).toBeInTheDocument();

  rerender(
    <DataView
      state="error"
      items={[]}
      errorRequestId="req-123"
      onRetry={() => {}}
      renderReady={() => null}
    />,
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByText(/req-123/)).toBeInTheDocument();
});

test("dataView never treats loading-empty as empty state", () => {
  render(<DataView state="loading" items={[]} renderReady={() => null} />);
  expect(screen.queryByText("Belum ada data.")).toBeNull();
  expect(vi.fn()).not.toHaveBeenCalled();
});

test("denied and unavailable states carry distinct messages", () => {
  const { rerender } = render(
    <DataView
      state="permission-denied"
      items={[]}
      onRetry={vi.fn()}
      renderReady={() => null}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Akses tidak diizinkan.");
  expect(
    screen.queryByRole("button", { name: "Coba lagi" }),
  ).not.toBeInTheDocument();
  rerender(
    <DataView state="unavailable" items={[]} renderReady={() => null} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Data belum tersedia.");
});

test("checkbox toggles through its label", async () => {
  const user = userEvent.setup();
  function Example() {
    const [checked, setChecked] = useState<boolean | "indeterminate">(false);
    return (
      <label className="flex items-center gap-2">
        <Checkbox checked={checked} onCheckedChange={setChecked} />
        Pilih perangkat
      </label>
    );
  }
  render(<Example />);
  const box = screen.getByRole("checkbox", { name: "Pilih perangkat" });
  expect(box).toHaveAttribute("aria-checked", "false");
  await user.click(box);
  expect(box).toHaveAttribute("aria-checked", "true");
});

test("checkbox exposes the indeterminate mixed state", () => {
  render(
    <label className="flex items-center gap-2">
      <Checkbox checked="indeterminate" onCheckedChange={() => {}} />
      Pilih semua
    </label>,
  );
  expect(screen.getByRole("checkbox", { name: "Pilih semua" })).toHaveAttribute(
    "aria-checked",
    "mixed",
  );
});

test("textarea stays wired to its label and accepts input", async () => {
  const user = userEvent.setup();
  render(
    <label className="flex flex-col gap-2">
      Catatan
      <Textarea />
    </label>,
  );
  const area = screen.getByLabelText("Catatan");
  await user.type(area, "profil L2TP kantor");
  expect(area).toHaveValue("profil L2TP kantor");
});

test("alertDialog focuses cancel first and reports the chosen action", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Hapus pengguna</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pengguna ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Ya, hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Hapus pengguna" }));
  const dialog = screen.getByRole("alertdialog", {
    name: "Hapus pengguna ini?",
  });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(screen.getByRole("button", { name: "Batal" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Ya, hapus" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("dropdownMenu opens, selects an item and closes with Escape", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Aksi</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onSelect}>Buka detail</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Hapus</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await user.click(screen.getByRole("button", { name: "Aksi" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Buka detail" }));
  expect(onSelect).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Aksi" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
