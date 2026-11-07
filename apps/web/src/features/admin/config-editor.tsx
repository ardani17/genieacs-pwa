"use client";

// Config editor (M06-B): edits native config VALUES as expression
// strings — round-trip exact. Credential-looking entries stay masked
// until an authorized reader reveals them explicitly; responses are
// private/no-store and contents never logged.
import { ResourceEditor } from "./resource-editor";

export function ConfigEditor({
  canRevealSecrets,
}: {
  canRevealSecrets: boolean;
}) {
  return (
    <ResourceEditor
      canRevealSecrets={canRevealSecrets}
      config={{
        resource: "config",
        title: "Konfigurasi",
        language: "expression",
        sourceField: "value",
        blankDocument: () => ({ _id: "", value: "" }),
      }}
    />
  );
}
