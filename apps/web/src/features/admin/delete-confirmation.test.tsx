import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConfigEditor } from "./config-editor";
import { FileManager } from "./files";
import { PermissionManager } from "./permissions";
import { UserManager } from "./users";

vi.mock("./code-editor", () => ({ CodeEditor: () => null }));

const cases = [
  { name: "config", render: () => <ConfigEditor canRevealSecrets={false} /> },
  { name: "files", render: () => <FileManager /> },
  { name: "permissions", render: () => <PermissionManager /> },
  { name: "users", render: () => <UserManager /> },
];

it.each(cases)(
  "$name deletion waits for the server, blocks duplicate submits and preserves retry context",
  async (view) => {
    let settle!: (response: Response) => void;
    let deletions = 0;
    let deleted = false;
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (init?.method === "DELETE") {
          deletions += 1;
          if (deletions === 1)
            return new Promise<Response>((resolve) => {
              settle = resolve;
            });
          deleted = true;
          return new Response(JSON.stringify({ ok: true, data: {} }));
        }
        const url = new URL(String(input), "http://localhost");
        const data = url.pathname.endsWith("/config/fixture")
          ? { _id: "fixture", value: '"value"' }
          : {
              items: deleted
                ? []
                : [
                    {
                      _id: "fixture",
                      roles: "operator",
                      role: "operator",
                      resource: "devices",
                      access: 2,
                    },
                  ],
            };
        return new Response(JSON.stringify({ ok: true, data }));
      });
    render(view.render());
    if (view.name === "config")
      fireEvent.click(await screen.findByRole("link", { name: "fixture" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Hapus",
    });
    const cancel = within(dialog).getByRole("button", { name: "Batal" });
    fireEvent.click(confirm);
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    expect(deletions).toBe(1);
    await act(async () =>
      settle(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "FORBIDDEN",
              message: "Deletion refused",
              retryable: false,
            },
            requestId: "fixture",
          }),
          { status: 403 },
        ),
      ),
    );
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      /tidak dapat dihapus|Deletion refused/,
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deletions).toBe(2);
    const deleteUrls = fetcher.mock.calls
      .filter(([, init]) => init?.method === "DELETE")
      .map(([input]) => String(input));
    expect(deleteUrls[1]).toBe(deleteUrls[0]);
  },
);

it("file deletion recovers from a network failure without losing the confirmation target", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (init?.method === "DELETE") throw new Error("offline");
    return new Response(
      JSON.stringify({ ok: true, data: { items: [{ _id: "fixture" }] } }),
    );
  });
  render(<FileManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Hapus" }));
  expect(await within(dialog).findByRole("status")).toHaveTextContent(
    "koneksi terputus",
  );
  expect(within(dialog).getByRole("button", { name: "Hapus" })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
