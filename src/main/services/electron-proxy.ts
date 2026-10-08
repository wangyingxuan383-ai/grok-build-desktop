/** Chromium accepts a proxy origin, but rejects a standard URL's trailing slash. */
export function electronProxyRules(value: string): string {
  const text = value.trim();
  try {
    const url = new URL(text);
    if (["http:", "https:", "socks4:", "socks5:"].includes(url.protocol) &&
        !url.username && !url.password && !url.search && !url.hash && (!url.pathname || url.pathname === "/")) {
      return `${url.protocol}//${url.host}`;
    }
  } catch { /* Chromium also supports bare hosts and multi-protocol rules. */ }
  return text;
}
