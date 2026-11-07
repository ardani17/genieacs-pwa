"use client";

// CodeEditor (M06-B): React wrapper around CodeMirror 5.65.21 (pinned).
// The editor instance is created ONCE per mount and destroyed on
// unmount; value changes sync into the document without touching
// history/selection. The contenteditable editing surface carries the
// accessible textbox semantics (aria-label "Kode" by default), so tests
// and assistive tech drive the VISIBLE editor. Find/replace, undo/redo,
// JS/YAML highlighting and indent come from the CodeMirror keymap —
// provision code is NEVER executed in the browser.
import { useEffect, useRef, useState } from "react";
import type { Editor, EditorConfiguration } from "codemirror";

export type CodeLanguage = "javascript" | "yaml" | "expression";

type CodeMirrorFactory = (
  host: HTMLElement,
  config: EditorConfiguration,
) => Editor;

export function CodeEditor({
  value,
  language,
  readOnly,
  onChange,
  label = "Kode",
}: {
  value: string;
  language: CodeLanguage;
  readOnly?: boolean;
  onChange?: (next: string) => void;
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  // The CodeMirror factory arrives through a dynamic, client-only
  // import (CodeMirror touches window at import time).
  const [createEditor, setCreateEditor] = useState<CodeMirrorFactory | null>(
    null,
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      import("codemirror"),
      import("codemirror/mode/javascript/javascript.js"),
      import("codemirror/mode/yaml/yaml.js"),
      import("codemirror/addon/edit/closebrackets.js"),
      import("codemirror/addon/edit/matchbrackets.js"),
    ])
      .then(([cm]) => {
        if (disposed) return;
        setCreateEditor(
          () => (cm.default ?? cm) as unknown as CodeMirrorFactory,
        );
      })
      .catch(() => {
        // Dynamic import failure leaves the empty host; nothing to
        // tear down and no state to expose.
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!createEditor || !hostRef.current) return undefined;
    const editor = createEditor(hostRef.current, {
      value,
      mode:
        language === "javascript"
          ? "javascript"
          : language === "yaml"
            ? "yaml"
            : "text/plain",
      readOnly: !!readOnly,
      lineNumbers: true,
      // Contenteditable serves touch/mobile keyboards; the textarea
      // input style is the robust default for pointer devices (and
      // the programmatic value sync).
      inputStyle:
        typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)").matches
          ? "contenteditable"
          : "textarea",
      autoCloseBrackets: !readOnly,
      matchBrackets: true,
      indentUnit: 2,
      tabSize: 2,
    });
    // The editable input surface carries the accessible textbox
    // semantics (role+aria-label on the contenteditable itself, so
    // fill/keyboard drivers target the real editable element).
    const input = editor.getInputField();
    input.setAttribute("aria-label", label);
    input.setAttribute("role", "textbox");
    input.setAttribute("aria-multiline", "true");
    if (readOnly) input.setAttribute("aria-readonly", "true");
    const changeHandler = (): void => {
      onChangeRef.current?.(editor.getValue());
    };
    editor.on("change", changeHandler);
    editorRef.current = editor;
    setReady(true);
    const host = hostRef.current;
    return () => {
      editor.off("change", changeHandler);
      editorRef.current = null;
      setReady(false);
      if (host) host.textContent = "";
    };
    // Editor creation intentionally depends only on the factory
    // arriving: value sync happens through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createEditor]);

  // Sync external value changes WITHOUT resetting selection/undo.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && ready && editor.getValue() !== value) {
      const cursor = editor.getCursor();
      editor.operation(() => {
        editor.setValue(value);
        editor.setCursor(cursor);
      });
    }
  }, [value, ready]);

  return (
    <div ref={hostRef} className="overflow-hidden rounded-lg border text-sm" />
  );
}
