"use client";

// Provision / virtual-parameter editors (M06-B): configuration lives
// INSIDE the client component — function props never cross the
// server→client boundary.
import { ResourceEditor } from "./resource-editor";

export function ProvisionEditor() {
  return (
    <ResourceEditor
      config={{
        resource: "provisions",
        title: "Provision",
        language: "javascript",
        sourceField: "script",
        blankDocument: () => ({ _id: "", script: "" }),
      }}
    />
  );
}

export function VirtualParameterEditor() {
  return (
    <ResourceEditor
      config={{
        resource: "virtualParameters",
        title: "Virtual parameter",
        language: "javascript",
        sourceField: "script",
        blankDocument: () => ({ _id: "", script: "" }),
      }}
    />
  );
}
