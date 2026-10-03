"use client";

import dynamic from "next/dynamic";

// The editor is a client-only app (canvas, localStorage, pointer input): skip SSR
// and restore the autosaved project before its first render.
const Editor = dynamic(
  () =>
    import("@/components/Editor").then((m) => {
      m.bootstrapEditor();
      return m.Editor;
    }),
  { ssr: false, loading: () => <div className="boot">Loading AlgoLiquid Studio…</div> },
);

export default function Page() {
  return <Editor />;
}
