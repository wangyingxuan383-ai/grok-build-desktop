import { describe, expect, it, vi } from "vitest";
import { configureAutomationWorkerStorage } from "./automation-worker-storage";

describe("automation worker storage", () => {
  it("copies Local State before isolating worker session data", () => {
    const setPath = vi.fn();
    const mkdirSync = vi.fn();
    const copyFileSync = vi.fn();
    const app = {
      getPath: (name: string) => name === "appData" ? "D:\\User Data\\Roaming" : "D:\\Temp",
      setPath,
    };

    const result = configureAutomationWorkerStorage(app as never, 1234, { mkdirSync, copyFileSync });

    expect(result.canonicalUserData).toBe("D:\\User Data\\Roaming\\Grok Build Desktop");
    expect(result.workerSessionData).toBe("D:\\Temp\\grok-build-desktop-worker-1234");
    expect(mkdirSync).toHaveBeenCalledWith(result.workerSessionData, { recursive: true });
    expect(copyFileSync).toHaveBeenCalledWith(
      "D:\\User Data\\Roaming\\Grok Build Desktop\\Local State",
      "D:\\Temp\\grok-build-desktop-worker-1234\\Local State",
    );
    expect(setPath).toHaveBeenNthCalledWith(1, "userData", result.canonicalUserData);
    expect(setPath).toHaveBeenNthCalledWith(2, "sessionData", result.workerSessionData);
  });
});
