"use client";

// Preset editor (M06-B): presets round-trip as structured documents —
// the editor shows a JSON view (valid YAML) and PUTs the parsed native
// object, so conditions/events/schedules/provisions keep their exact
// shapes and expression strings. No provision execution in browser.
import { ResourceEditor } from "./resource-editor";

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
        deserialize: (source, draft) => ({
          ...JSON.parse(source),
          _id: draft["_id"],
        }),
      }}
    />
  );
}
