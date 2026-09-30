import { Segmented } from "./ui/Display";

export type AppMode = "code" | "image";

/** The 编程 / 图像 switch. Both modes render it at the top of their sidebar, in the same place. */
export function ModeSwitch({ mode, onMode }: { mode: AppMode; onMode(mode: AppMode): void }): React.JSX.Element {
  return (
    <div className="sb-top">
      <Segmented<AppMode>
        label="应用模式"
        className="sb-mode"
        value={mode}
        onChange={onMode}
        items={[{ value: "code", label: "编程", icon: "code" }, { value: "image", label: "图像", icon: "image" }]}
      />
    </div>
  );
}
