// ResourceEditor shared model (split from resource-editor.tsx so the
// component file exports components only): the editor config contract
// and the credential-masking helper (M06-B).
import type { CodeLanguage } from "./code-editor";

export interface ResourceEditorConfig {
  resource: string;
  title: string;
  language: CodeLanguage;
  // Which document field holds the editable source; new documents are
  // created with this field empty.
  sourceField: string;
  blankDocument: () => Record<string, unknown>;
  // Optional storage transforms: presets (and similar structured
  // resources) edit a serialized view but PUT the native object.
  serialize?: (doc: Record<string, unknown>) => string;
  deserialize?: (
    source: string,
    draft: Record<string, unknown>,
  ) => Record<string, unknown>;
}

const CREDENTIAL_LOOKING = /password|secret|token|key|credential/i;

export function maskValue(id: string, value: string): string {
  if (CREDENTIAL_LOOKING.test(id)) return "••••••••";
  return value;
}
