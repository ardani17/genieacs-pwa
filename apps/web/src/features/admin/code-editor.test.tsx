import { beforeAll, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "codemirror";
import { CodeEditor } from "./code-editor";

beforeAll(() => {
  // CodeMirror measures text ranges; jsdom has no layout engine.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

it("external value sync does not report a user edit, while typing does", async () => {
  const onChange = vi.fn();
  const { container, rerender } = render(
    <CodeEditor value='"original"' language="expression" onChange={onChange} />,
  );
  await screen.findByRole("textbox", { name: "Kode" });
  rerender(
    <CodeEditor
      value="••••••••"
      language="expression"
      readOnly
      onChange={onChange}
    />,
  );
  await waitFor(() => expect(container).toHaveTextContent("••••••••"));
  expect(onChange).not.toHaveBeenCalled();
  const editor = (
    container.querySelector(".CodeMirror") as HTMLElement & {
      CodeMirror: Editor;
    }
  ).CodeMirror;
  act(() =>
    editor.replaceRange("typed", { line: 0, ch: 0 }, undefined, "+input"),
  );
  expect(onChange).toHaveBeenCalledWith("typed••••••••");
});
