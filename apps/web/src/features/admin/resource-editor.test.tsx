import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigEditor } from "./config-editor";

vi.mock("./code-editor", () => ({
  CodeEditor: ({
    value,
    readOnly,
    onChange,
  }: {
    value: string;
    readOnly: boolean;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Kode"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function mockConfig() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    const data = url.pathname.endsWith("/config")
      ? { items: [{ _id: "app.testSecret" }] }
      : {
          _id: "app.testSecret",
          value: url.searchParams.has("reveal")
            ? '"fixture-value"'
            : "••••••••",
        };
    return new Response(JSON.stringify({ ok: true, data }));
  });
}

it("server-masked config stays read-only and supports explicit reveal and hide", async () => {
  const fetcher = mockConfig();
  render(<ConfigEditor canRevealSecrets />);
  fireEvent.click(await screen.findByRole("link", { name: "app.testSecret" }));
  const editor = await screen.findByRole("textbox", { name: "Kode" });
  expect(editor).toHaveValue("••••••••");
  expect(editor).toHaveAttribute("readonly");
  fireEvent.click(screen.getByRole("button", { name: "Tampilkan nilai" }));
  await waitFor(() => expect(editor).toHaveValue('"fixture-value"'));
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes("reveal=1")),
  ).toBe(true);
  expect(editor).not.toHaveAttribute("readonly");
  fireEvent.change(editor, { target: { value: '"edited-draft"' } });
  fireEvent.click(screen.getByRole("button", { name: "Sembunyikan" }));
  expect(editor).toHaveValue("••••••••");
  expect(editor).toHaveAttribute("readonly");
  fireEvent.click(screen.getByRole("button", { name: "Tampilkan nilai" }));
  await waitFor(() => expect(editor).toHaveValue('"edited-draft"'));
});

it("readers without reveal permission cannot edit the mask sentinel", async () => {
  mockConfig();
  render(<ConfigEditor canRevealSecrets={false} />);
  fireEvent.click(await screen.findByRole("link", { name: "app.testSecret" }));
  const editor = await screen.findByRole("textbox", { name: "Kode" });
  expect(editor).toHaveAttribute("readonly");
  expect(screen.queryByRole("button", { name: "Tampilkan nilai" })).toBeNull();
});
