import { useAppStore } from "../store";
import { UiIcon } from "../ui-icons";
import { updateAvailability } from "../update-availability";

/** Both modes route to the same update center. A failed check is not an update. */
export function UpdateIndicator({ onOpen, showVersion = false }: { onOpen(): void; showVersion?: boolean }): React.JSX.Element {
  const cli = useAppStore(state => state.cli);
  const app = useAppStore(state => state.appRelease);
  const enabled = useAppStore(state => state.settings?.automaticUpdateChecks !== false);
  const version = useAppStore(state => state.appVersion);
  const updates = updateAvailability(cli, app, enabled);
  const label = updates.length ? `发现可用更新：${updates.join("、")}` : "版本与更新";
  return <button type="button" className="sb-version update-indicator" title={label} aria-label={label} onClick={onOpen}>
    <UiIcon name="download" size={14} />{showVersion && version}
    {updates.length > 0 && <span className="update-indicator-dot" aria-hidden="true" />}
  </button>;
}
