import { expect, it } from "vitest";
import { electronProxyRules } from "./electron-proxy";
it("normalizes URL origins for Chromium without a path", () => {
  expect(electronProxyRules(" http://proxy.example.invalid:3128/ ")).toBe("http://proxy.example.invalid:3128");
  expect(electronProxyRules("https://proxy.example.invalid:8443/")).toBe("https://proxy.example.invalid:8443");
  expect(electronProxyRules("socks5://proxy.example.invalid:1080/")).toBe("socks5://proxy.example.invalid:1080");
  expect(electronProxyRules("http://[::1]:3128/")).toBe("http://[::1]:3128");
});
it("preserves existing Chromium rules and never silently discards credentials or a path", () => {
  for (const value of ["proxy.example.invalid:3128", "http=proxy.example.invalid:3128;https=proxy.example.invalid:3128", "http://user:pass@proxy.example.invalid:3128/", "http://proxy.example.invalid/path", "http://proxy.example.invalid/?key=value"]) expect(electronProxyRules(value)).toBe(value);
});
