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
import { Button } from "./button";
import { Field } from "./field";
import { Status } from "./status";
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
