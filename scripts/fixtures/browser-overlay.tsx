import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserSurface } from "../../src/renderer/src/components/BrowserWorkbench";
import { ExportSessionPanel } from "../../src/renderer/src/components/ExportSessionPanel";
import "../../src/renderer/src/styles.css";

const probe = (window as any).browserProbe;
Object.assign(window, { grokDesktop: { boundsWorkspaceBrowser: probe.bounds } });
const api = {
  previewSessionExport: async () => ({ content: "Isolated export preview", format: "markdown" as const, redacted: true, redactionCount: 0, fileName: "fixture.md" }),
  saveSessionExport: async () => undefined,
};
function Fixture({ id }: { id: string }) {
  const [overlay, setOverlay] = useState("");
  Object.assign(window, { setBrowserOverlay: setOverlay });
  return <><div style={{ position: "absolute", inset: "100px 40px 40px", display: "flex" }}><BrowserSurface id={id}/></div>
    {overlay === "export" && <ExportSessionPanel sessionId="fixture" api={api} onClose={() => setOverlay("")}/>}
    {overlay === "alert" && <div role="alertdialog" style={{ position: "fixed", inset: "150px", background: "white" }}>Confirm action</div>}
    {overlay === "hidden" && <div role="dialog" hidden>Hidden dialog</div>}
  </>;
}
const root = createRoot(document.getElementById("root")!);
Object.assign(window, { showBrowserFixture: (id: string) => root.render(<Fixture id={id}/>) });
