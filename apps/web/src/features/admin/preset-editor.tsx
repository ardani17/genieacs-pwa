"use client";

// Preset editor (M06-B): presets round-trip as structured documents —
// the editor shows a JSON view (valid YAML) and PUTs the parsed native
// object, so conditions/events/schedules/provisions keep their exact
// shapes and expression strings. No provision execution in browser.
import { parse as yamlParseNative } from "yaml";
import { ResourceEditor } from "./resource-editor";

function yamlParse(source: string): Record<string, unknown> {
  const doc = yamlParseNative(source);
  if (doc == null || typeof doc !== "object" || Array.isArray(doc))
    throw new Error("Dokumen YAML harus berupa objek.");
  return doc as Record<string, unknown>;
}

export function PresetEditor() {
  return (
    <ResourceEditor
      config={{
        resource: "presets",
        title: "Preset",
        language: "yaml",
        sourceField: "yaml",
        blankDocument: () => ({ _id: "", yaml: "{}" }),
        serialize: (doc) => {
          const { ...rest } = doc;
          delete (rest as Record<string, unknown>)["_id"];
          return JSON.stringify(rest, null, 2);
        },
        // The editor surfaces YAML; accept any YAML document (JSON is
        // valid YAML) — parse errors surface before any write.
        deserialize: (source, draft) => ({
          ...yamlParse(source),
          _id: draft["_id"],
        }),
      }}
    />
  );
}
