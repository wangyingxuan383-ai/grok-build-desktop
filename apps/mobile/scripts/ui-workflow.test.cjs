const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const Module = require("node:module");
const ts = require("typescript"), React = require("react"), renderer = require("react-test-renderer");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(relative, mocks) {
  const path = resolve(__dirname, "..", relative), mod = new Module(path);
  mod.paths = Module._nodeModulePaths(join(__dirname, ".."));
  mod.require = id => id in mocks ? mocks[id] : require(id);
  mod._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, path);
  return mod.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const host = (fingerprint = "a", address = "https://a.example.invalid") => ({ id: fingerprint, fingerprint: fingerprint.repeat(64), host: address, token: "fixture", name: fingerprint });
const native = { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput", FlatList: "FlatList", KeyboardAvoidingView: "KeyboardAvoidingView", ActivityIndicator: "ActivityIndicator", Platform: { OS: "android" }, Keyboard: { dismiss() {} }, Vibration: { vibrate() {} }, StyleSheet: { create: x => x, hairlineWidth: 1 }, useColorScheme: () => "light", AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } };

test("overview ignores late responses after switching computers, including manual refresh", async () => {
  let current = host(), hook, calls = 0; const pending = [deferred(), deferred()], writes = [];
  const query = () => pending[calls++].promise;
  const { useOverview } = load("src/use-overview.ts", { "react-native": native, "./cache": { cacheRead: async () => undefined, cacheWrite: async (key, value) => { writes.push({ key, value }); } } });
  function Probe() { hook = useOverview({ host: current, query }); return null; }
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Probe)); });
    const oldRefresh = hook.refresh;
    await renderer.act(async () => { void hook.refresh(); current = host("b"); tree.update(React.createElement(Probe)); });
    assert.equal(calls, 2);
    await renderer.act(async () => { await oldRefresh(); });
    assert.equal(calls, 2, "an obsolete callback must not query the newly selected computer");
    await renderer.act(async () => { pending[1].resolve({ accounts: [{ id: "B" }] }); await settle(); });
    await renderer.act(async () => { pending[0].resolve({ accounts: [{ id: "A" }] }); await settle(); });
    assert.equal(hook.value.accounts[0].id, "B"); assert.equal(writes.length, 1); assert.equal(writes[0].key, current.fingerprint + ":overview");
  } finally { if (tree) await renderer.act(() => tree.unmount()); }
});

test("overview restarts after an address change and an old failure cannot pollute it", async () => {
  let current = host(), hook, calls = 0; const pending = [deferred(), deferred()];
  const query = () => pending[calls++].promise;
  const { useOverview } = load("src/use-overview.ts", { "react-native": native, "./cache": { cacheRead: async () => undefined, cacheWrite: async () => { throw Error("cache full"); } } });
  function Probe() { hook = useOverview({ host: current, query }); return null; }
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Probe)); });
    await renderer.act(async () => { current = { ...current, host: "https://new.example.invalid" }; tree.update(React.createElement(Probe)); });
    assert.equal(calls, 2);
    await renderer.act(async () => { pending[1].resolve({ serverTime: 2 }); await settle(); });
    await renderer.act(async () => { pending[0].reject(Error("obsolete address")); await settle(); });
    assert.equal(hook.value.serverTime, 2); assert.equal(hook.error, ""); assert.equal(hook.loading, false);
  } finally { if (tree) await renderer.act(() => tree.unmount()); }
});

test("overview shares a pending request and a late cache read does not replace fresh data", async () => {
  let hook, calls = 0; const network = deferred(), cache = deferred();
  const { useOverview } = load("src/use-overview.ts", { "react-native": native, "./cache": { cacheRead: () => cache.promise, cacheWrite: async () => {} } });
  const client = { host: host(), query: () => { calls++; return network.promise; } };
  function Probe() { hook = useOverview(client); return null; } let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Probe)); });
    assert.equal(hook.refresh(), hook.refresh()); assert.equal(calls, 1);
    await renderer.act(async () => { network.resolve({ serverTime: 2 }); await settle(); cache.resolve({ value: { serverTime: 1 } }); await settle(); });
    assert.equal(hook.value.serverTime, 2);
  } finally { if (tree) await renderer.act(() => tree.unmount()); }
});

function conversationModule(cache) {
  return load("src/conversation.tsx", {
    "react-native": native, "expo-clipboard": {}, "./markdown": { Markdown: "Markdown" },
    "./ui": { Button: "Button", Chip: "Chip", IconButton: "IconButton", font: {}, radius: {}, space: {}, ui: {} },
    "./remote-model": {}, "./app-model": load("src/app-model.ts", {}), "./cache": cache,
    "./conversation-navigator": { ConversationNavigator: "ConversationNavigator" }, "./gestures": { ActionMenu: "ActionMenu", haptic: () => {} },
  });
}
test("conversation history offers both pull refresh and an error retry", async () => {
  let refreshes = 0;
  const { Conversation } = conversationModule({});
  let tree;
  try {
    await renderer.act(() => { tree = renderer.create(React.createElement(Conversation, { rows: [], theme: {}, sessionId: "s", loading: false, refreshing: false, readError: "temporary", density: "compact", navigator: {}, api: { refresh: async () => { refreshes++; } } })); });
    await renderer.act(() => tree.root.findByType("FlatList").props.onRefresh());
    await renderer.act(() => tree.root.findAllByType("Button").find(button => button.props.title === "重试").props.onPress());
    assert.equal(refreshes, 2);
  } finally { if (tree) await renderer.act(() => tree.unmount()); }
});
test("a delayed reading preference cannot replace a density the user just selected", async () => {
  const read = deferred(), writes = []; let density;
  const { useReadingDensity } = conversationModule({ savedRead: () => read.promise, savedWrite: async (_, value) => writes.push(value) });
  function Probe() { density = useReadingDensity(); return null; } let tree;
  try {
    await renderer.act(() => { tree = renderer.create(React.createElement(Probe)); });
    await renderer.act(() => density[1]("full"));
    await renderer.act(async () => { read.resolve("standard"); await settle(); });
    assert.equal(density[0], "full"); assert.deepEqual(writes, ["full"]);
  } finally { if (tree) await renderer.act(() => tree.unmount()); }
});

function shellFixture() {
  const current = host(), preferences = { theme: "light", favorites: [], recent: [], mutedSessions: [], completion: false, failure: false, attention: false, updates: false };
  const controls = { busy: false, unknown: undefined, creationPending: false, recoveryReady: true, connection: { phase: "online" }, query: async () => ({}) };
  const writes = [], visits = [], pending = deferred(); let latest, back, historyRenders = 0;
  const query = (...args) => controls.query(...args);
  const sessions = [{ id: "parent", title: "Parent", canSend: true }, { id: "other", title: "Other", canSend: true }], events = [], rows = [];
  function useRemote(hostValue) {
    const [sessionId, setSession] = React.useState(""), [draft, setDraft] = React.useState("");
    const open = React.useCallback(id => { visits.push(id); setSession(id); }, []);
    latest = { ...controls, host: hostValue, sessionId, draft, setDraft, selectSession: open, query, sessions, older: events, snapshot: sessionId ? { session: sessions.find(s => s.id === sessionId), events, pending: [] } : undefined, composer: { attachments: [] }, materialsReady: true, setError: x => { controls.error = x; }, setNotice() {}, preserveDrafts: async () => {}, refresh: async () => {}, error: "", notice: "", loading: false, refreshing: false };
    return latest;
  }
  const theme = { bg: "white", accent: "blue" };
  const components = { Button: "Button", palettes: { dark: theme, light: theme } };
  const App = load("App.tsx", {
    "react-native": { ...native, BackHandler: { addEventListener: (_, callback) => { back = callback; return { remove() {} }; } } },
    "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" },
    "expo-secure-store": { getItemAsync: async key => key === "grok.remote.host.v1" ? JSON.stringify(current) : JSON.stringify([current, host("b")]), setItemAsync: async (...args) => writes.push(args) },
    "@react-native-async-storage/async-storage": { getItem: async () => JSON.stringify(preferences), setItem: async () => {} },
    "expo-status-bar": { StatusBar: "StatusBar" },
    "expo-notifications": { getLastNotificationResponseAsync: async () => null, addNotificationResponseReceivedListener: () => ({ remove() {} }) },
    "./src/version": { MOBILE_VERSION: "0.3.4" }, "./src/workbench": { AssetViewer: "AssetViewer" },
    "./src/task-workspace": { TaskWorkspace: "TaskWorkspace" }, "./src/image-workspace": { ImageWorkspaceScreen: "ImageWorkspaceScreen" },
    "./src/transport": { sharedItems: async () => ({ text: "", files: [] }), setMonitoring: async () => {}, noticePolicy: async () => {} },
    "./src/share-inbox": { ShareInbox: "ShareInbox" }, "./src/cache": { savedRead: async () => undefined, savedWrite: async () => {} },
    "./src/remote-model": { messagesFromEvents: () => rows, mergeEventWindows: () => events, conversationRows: x => x, sessionStatusLabel: () => "" },
    "./src/experience-model": { rememberSession: (_, id) => [id] }, "./src/app-model": load("src/app-model.ts", {}),
    "./src/use-remote": { useRemote }, "./src/ui": components,
    "./src/screens": { SessionList: "SessionList", defaultPrefs: preferences },
    "./src/conversation": { Conversation: React.memo(props => { historyRenders++; return React.createElement("Conversation", props); }), Composer: "Composer", ConversationFrame: "ConversationFrame", useReadingDensity: () => ["compact", () => {}] },
    "./src/forms": { Pairing: "Pairing", confirm: (_, __, action) => action() },
    "./src/app-chrome": { AppHeader: "AppHeader", StatusBanners: "StatusBanners", TabBar: "TabBar", tabTitles: {} },
    "./src/session-sheets": { SheetHost: "SheetHost" }, "./src/device-screen": { DeviceScreen: "DeviceScreen" },
  }).default;
  return { App, controls, writes, visits, pending, get latest() { return latest; }, get back() { return back; }, get historyRenders() { return historyRenders; } };
}

// App imports Linking from React Native separately; all fixtures use inert notifications.
native.Linking = { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) };
async function withShell(run) {
  native.Linking = { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) };
  const fixture = shellFixture(); let tree;
  try { await renderer.act(async () => { tree = renderer.create(React.createElement(fixture.App)); await settle(); }); await run(fixture, tree); }
  finally { if (tree) await renderer.act(() => tree.unmount()); }
}

test("typing updates the composer without rerendering the loaded conversation", async () => withShell(async (f, tree) => {
  await renderer.act(() => tree.root.findByType("SessionList").props.onOpen("parent"));
  const before = f.historyRenders;
  for (const text of ["你", "你好", "你好世界"]) await renderer.act(() => f.latest.setDraft(text));
  assert.equal(tree.root.findByType("Composer").props.client.draft, "你好世界"); assert.equal(f.historyRenders, before);
}));

test("an uncertain offline submission prevents changing computer or address", async () => withShell(async (f, tree) => {
  f.controls.unknown = { command: { operationId: "pending" } }; f.controls.connection = { phase: "offline" };
  await renderer.act(() => tree.root.findByType("TabBar").props.onChange("settings"));
  const device = tree.root.findByType("DeviceScreen");
  await assert.rejects(device.props.onSelect(host("b")), /核对/);
  await assert.rejects(device.props.onSelect({ ...device.props.host, host: "https://new.example.invalid" }), /核对/);
  assert.equal(f.writes.length, 0);
}));

test("a delayed child lookup cannot reopen a session after the user returns to the list", async () => withShell(async (f, tree) => {
  await renderer.act(() => tree.root.findByType("SessionList").props.onOpen("parent"));
  f.controls.query = () => f.pending.promise;
  await renderer.act(() => tree.root.findByType("Conversation").props.onChild("unloaded-child"));
  await renderer.act(() => tree.root.findByType("AppHeader").props.onBack());
  await renderer.act(async () => { f.pending.resolve({}); await settle(); });
  assert.equal(f.latest.sessionId, ""); assert.equal(f.visits.includes("unloaded-child"), false);
}));

test("Android back returns from pairing to the already paired computer", async () => withShell(async (f, tree) => {
  await renderer.act(() => tree.root.findByType("TabBar").props.onChange("settings"));
  await renderer.act(() => tree.root.findByType("DeviceScreen").props.onPair());
  assert.equal(tree.root.findAllByType("Pairing").length, 1);
  await renderer.act(() => assert.equal(f.back(), true));
  assert.equal(tree.root.findAllByType("Pairing").length, 0); assert.equal(tree.root.findAllByType("DeviceScreen").length, 1);
}));

test("dismissing a failed-send banner hides that receipt but exposes the next failure", async () => withShell(async (f, tree) => {
  f.controls.receipt = { operationId: "failed-1", state: "failed" };
  f.controls.submitted = { command: { action: "send", sessionId: "parent" } };
  await renderer.act(() => tree.root.findByType("SessionList").props.onOpen("parent"));
  assert.equal(tree.root.findByType("StatusBanners").props.input.failedSend, true);
  await renderer.act(() => tree.root.findByType("StatusBanners").props.onDismissError());
  assert.equal(tree.root.findByType("StatusBanners").props.input.failedSend, false);
  f.controls.receipt = { operationId: "failed-2", state: "failed" };
  await renderer.act(() => f.latest.setDraft("new draft"));
  assert.equal(tree.root.findByType("StatusBanners").props.input.failedSend, true);
}));

test("a late computer discovery cannot switch hosts after leaving the device screen", async () => {
  const pending = deferred(), selections = [], computer = host();
  const { DeviceScreen } = load("src/device-screen.tsx", {
    "react-native": { ...native, Switch: "Switch", RefreshControl: "RefreshControl" },
    "expo-file-system/legacy": {}, "expo-sharing": {}, "expo-notifications": {},
    "./version": { MOBILE_VERSION: "0.3.4" }, "./ui": { Badge: "Badge", Button: "Button", ListRow: "ListRow", Section: "Section", Segmented: "Segmented", font: {}, space: {}, ui: {} },
    "./cache": {}, "./transport": { monitoringStatus: async () => false, discoverComputers: () => pending.promise },
    "./MobileUpdate": { MobileUpdate: "MobileUpdate" }, "./experience-model": {}, "./task-workspace": { useOverview: () => ({}) }, "./forms": {},
  });
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(DeviceScreen, { client: { host: computer, connection: { phase: "online" }, recoveryReady: true, query: async () => ({}) }, theme: {}, host: computer, computers: [], preferences: {}, onSelect: async value => selections.push(value) })); await settle(); });
  await renderer.act(() => tree.root.findAllByType("ListRow").find(row => row.props.title === "重新发现电脑地址").props.onPress());
  await renderer.act(() => tree.unmount());
  await renderer.act(async () => { pending.resolve([{ fingerprint: computer.fingerprint, host: "https://new.example.invalid" }]); await settle(); });
  assert.equal(selections.length, 0);
});
test("composer clears the keyboard only by the real overlap, never twice on resizing devices", () => {
  const { keyboardOverlap } = conversationModule({});
  assert.equal(keyboardOverlap(860, 520), 340);
  assert.equal(keyboardOverlap(520, 520), 0);
  assert.equal(keyboardOverlap(500, 520), 0);
});
test("phone updates work without a computer, verify before install, and require explicit actions", async () => {
  let installs = 0, downloads = 0, calls = 0, event;
  const release = { version: "0.3.6", name: "Grok-Remote-v0.3.6.apk", size: 100, sha256: "a".repeat(64), downloadUrl: "https://github.com/demo/app/releases/download/v1/mobile.apk" };
  const { MobileUpdate } = load("src/MobileUpdate.tsx", {
    "react-native": native, "./ui": { Button: "Button", space: {}, ui: {} }, "./version": { MOBILE_VERSION: "0.3.5" },
    "./experience-model": { mobileVersionIsNewer: (a, b) => a !== b }, "./mobile-update-model": { parseMobileRelease: () => release, RELEASE_PAGE: "https://example.invalid/releases" },
    "./transport": {
      checkPublicRelease: async () => { calls++; return "{}"; }, mobileUpdateStatus: async () => ({ phase: "idle", received: 0 }),
      watchMobileUpdate: listener => { event = listener; return { remove() {} }; }, cancelMobileUpdate: async () => {},
      downloadMobileUpdate: async () => { downloads++; return { phase: "ready", received: 100, version: "0.3.6" }; },
      installMobileUpdate: async () => { installs++; return "permission"; },
    },
  });
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(MobileUpdate, { theme: {}, automatic: true })); await settle(); });
    assert.equal(calls, 1); assert.equal(downloads, 0); assert.equal(installs, 0);
    const button = name => tree.root.findAllByType("Button").find(x => x.props.title === name);
    await renderer.act(async () => button("下载更新 0.3.6").props.onPress());
    assert.equal(downloads, 1); assert.equal(installs, 0);
    await renderer.act(async () => button("安装 0.3.6").props.onPress());
    assert.equal(installs, 1);
    assert.ok(tree.root.findAllByType("Text").some(x => String(x.props.children).includes("再次点击安装")));
    await renderer.act(() => event({ phase: "downloading", received: 50, total: 100, version: "0.3.6" }));
    assert.equal(tree.root.findByProps({ accessibilityRole: "progressbar" }).props.accessibilityValue.now, 50);
  } finally { if (tree) await renderer.act(() => tree.unmount()); }
});
