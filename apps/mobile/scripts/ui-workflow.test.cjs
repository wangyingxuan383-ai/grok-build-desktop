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
  mod.require = id => id in mocks ? mocks[id] : id in common ? common[id] : require(id);
  mod._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, path);
  return mod.exports;
}
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
const animated = { useSharedValue: value => ({ value }), useAnimatedStyle: () => ({}), useAnimatedKeyboard: () => ({ height: { value: 0 } }), withSpring: v => v, withTiming: v => v, runOnJS: f => f, interpolate: () => 0, FadeInDown: chain(), FadeOutDown: chain() };
const common = {
  "./src/media-cache": { setPrefetchWifiOnly() {} },
  "react-native-reanimated": { __esModule: true, default: { View: "AnimatedView" }, ...animated },
  "react-native-gesture-handler": { GestureDetector: ({ children }) => children, Gesture: chain(), GestureHandlerRootView: "GestureHandlerRootView", FlatList: "FlatList" },
  "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  "./haptics": { haptic() {}, setHapticsEnabled() {} }, "./src/haptics": { haptic() {}, setHapticsEnabled() {} },
  "./icons": { Icon: "Icon" }, "./toast": { showToast() {}, ToastHost: "ToastHost" }, "./src/toast": { showToast() {}, ToastHost: "ToastHost" },
  "./back-layers": { useBackLayer() {}, backStack: { handle: () => false } }, "./src/back-layers": { useBackLayer() {}, backStack: { handle: () => false } },
  "./src/use-notice-feed": { useNoticeFeed() {} }, "./src/app-lock": { LockScreen: "LockScreen", useAppLock: () => ({ locked: false, unlock() {} }) },
  "./src/gestures": { ActionMenu: "ActionMenu" }, "./src/markdown": { ReadingScale: React.createContext({}), readingScales: {} },
  "./src/inline-pending": { InlinePending: "InlinePending" }, "./src/library-model": { toggleBookmark: list => ({ list, added: true }) }, "./src/library": {},
  "./src/gallery-model": { applyToggles: list => list },
};
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
    "./remote-model": {}, "./app-model": load("src/app-model.ts", {}), "./cache": cache, "./back-layers": { useBackLayer() {} },
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
  const current = host(), preferences = { theme: "light", favorites: [], recent: [], mutedSessions: [], completion: false, failure: false, attention: false, updates: false, lock: { enabled: false, timeout: 1, secure: false }, haptics: true, monitorMode: "always", quiet: { enabled: false, start: 0, end: 0, allowAttention: true }, inApp: { completion: false, failure: false, attention: false }, hints: [], reading: "standard", keyboard: "native" };
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
    "./src/transport": { sharedItems: async () => ({ text: "", files: [] }), setMonitoring: async () => {}, noticePolicy: async () => {}, watchMobileUpdate: () => ({remove(){}}), cancelReceiptWatch: async () => {}, watchReceipt: async () => {}, notify: async () => {}, foregroundComputer: async () => {}, setMonitorMode: async () => {}, setQuietHours: async () => {} },
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

function deviceScreenModule(pending) {
  return load("src/device-screen.tsx", {
    "react-native": { ...native, Switch: "Switch", RefreshControl: "RefreshControl" },
    "expo-file-system/legacy": {}, "expo-sharing": {}, "expo-notifications": {}, "expo-clipboard": {},
    "./version": { MOBILE_VERSION: "0.4.0", MATCHING_DESKTOP_VERSION: "0.12.0" },
    "./ui": { Badge: "Badge", Banner: "Banner", Button: "Button", Card: "Card", Chip: "Chip", ListRow: "ListRow", Section: "Section", Segmented: "Segmented", Toggle: "Toggle", SearchField: "SearchField", SubpageHeader: "SubpageHeader", font: {}, radius: {}, space: {}, ui: {} },
    "./cache": { storageStatus: () => ({ ok: true, attempts: 1 }) },
    "./transport": { monitoringStatus: async () => false, monitoringDetail: async () => ({ following: false }), notificationHealth: async () => ({ enabled: true, channels: [], batteryExempt: true, mode: "always" }), discoverComputers: () => pending.promise, api: async () => ({ serverTime: Date.now() }) },
    "./MobileUpdate": { MobileUpdate: "MobileUpdate" }, "./task-workspace": { useOverview: () => ({}) }, "./forms": {},
    "./app-lock": {}, "./markdown": { Markdown: "Markdown", ReadingScale: React.createContext({}), readingScales: {} }, "./conversation": { densityLabels: {} },
    "./transfers": { subscribeTransfers: () => () => {}, transfersSnapshot: () => [] }, "./settings-model": load("src/settings-model.ts", {}),
  });
}
const deviceClient = computer => ({ host: computer, connection: { phase: "online" }, recoveryReady: true, sessions: [], query: async () => ({}), refresh() {}, reconnect() {} });
async function openConnectionPage(tree) {
  await renderer.act(() => tree.root.findAllByType("Pressable").find(item => item.props.accessibilityLabel === "连接与诊断").props.onPress());
  await renderer.act(async () => { await settle(); });
}

test("a late computer discovery cannot switch hosts after leaving the device screen", async () => {
  const pending = deferred(), selections = [], computer = host();
  const { DeviceScreen } = deviceScreenModule(pending);
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(DeviceScreen, { client: deviceClient(computer), theme: {}, host: computer, computers: [], preferences: { hints: [], lock: {} }, setPreferences() {}, onSelect: async value => selections.push(value) })); await settle(); });
  await openConnectionPage(tree);
  await renderer.act(() => tree.root.findAllByType("ListRow").find(row => row.props.title === "重新发现电脑地址").props.onPress());
  await renderer.act(() => tree.unmount());
  await renderer.act(async () => { pending.resolve([{ fingerprint: computer.fingerprint, host: "https://new.example.invalid" }]); await settle(); });
  assert.equal(selections.length, 0);
});

test("a discovery started before a manual address change cannot overwrite the new address", async () => {
  const pending = deferred(), selections = [], computer = host();
  const { DeviceScreen } = deviceScreenModule(pending);
  const props = address => ({ client: deviceClient({ ...computer, host: address }), theme: {}, host: { ...computer, host: address }, computers: [], preferences: { hints: [], lock: {} }, setPreferences() {}, onSelect: async value => selections.push(value) });
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(DeviceScreen, props(computer.host))); await settle(); });
    await openConnectionPage(tree);
    await renderer.act(() => tree.root.findAllByType("ListRow").find(row => row.props.title === "重新发现电脑地址").props.onPress());
    await renderer.act(async () => { tree.update(React.createElement(DeviceScreen, props("https://manual.example.invalid"))); await settle(); });
    await renderer.act(async () => { pending.resolve([{ fingerprint: computer.fingerprint, host: "https://discovered.example.invalid" }]); await settle(); });
    assert.equal(selections.length, 0);
  } finally { if (tree) await renderer.act(() => tree.unmount()); }
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

test("private windows work without enabling the app lock, and launch content is immediately locked", async () => {
  const secure = []; let state, handler;
  const rn = {...native, AppState:{currentState:"active",addEventListener:(_,fn)=>{handler=fn;return{remove(){}};}}};
  const {useAppLock}=load("src/app-lock.tsx", {"react-native":rn,"expo-local-authentication":{},"./transport":{configurePrivacy:async (_enabled,v)=>secure.push(v)},"./ui":{font:{},radius:{},space:{}}});
  let prefs={enabled:false,timeout:0,secure:true}, ready=true;
  function Probe(){state=useAppLock(prefs,ready);return null;}
  let tree;
  try{
    await renderer.act(()=>{tree=renderer.create(React.createElement(Probe));});
    assert.deepEqual(secure,[true]); assert.equal(state.locked,false);
    prefs={...prefs,enabled:true}; await renderer.act(()=>tree.update(React.createElement(Probe)));
    await renderer.act(()=>{handler("background");handler("active");}); assert.equal(state.locked,true);
    await renderer.act(()=>state.unlock()); assert.equal(state.locked,false);
  }finally{if(tree)await renderer.act(()=>tree.unmount());}
});

test("a corrupt thumbnail offers explicit retry instead of redownloading forever", async () => {
  let invalidated=0, attempts=[];
  const {PhotoTile}=load("src/photo-viewer.tsx", {"react-native":native,"expo-image":{Image:"ExpoImage"},"expo-sharing":{},"./transport":{},"./media-cache":{useThumbnail:(_c,_s,retry)=>{attempts.push(retry);return{uri:"file://photo",error:""};},invalidateCached:async()=>{invalidated++;}},"./ui":{font:{},radius:{},space:{}}});
  let tree;
  try{
    await renderer.act(()=>{tree=renderer.create(React.createElement(PhotoTile,{client:{},source:"photo",size:100,onPress(){}}));});
    await renderer.act(()=>tree.root.findByType("ExpoImage").props.onError());
    assert.equal(invalidated,1);assert.equal(tree.root.findAllByType("ExpoImage").length,0);assert.equal(attempts.at(-1),0);
    await renderer.act(()=>tree.root.findByType("Pressable").props.onPress());assert.equal(attempts.at(-1),1);
  }finally{if(tree)await renderer.act(()=>tree.unmount());}
});

test("a delayed snippet or recipe restore never replaces an edit", async () => {
  const pending=deferred(),writes=[];let value;
  const {useStored}=load("src/library.tsx", {"react-native":native,"./cache":{savedRead:()=>pending.promise,savedWrite:async(k,v)=>writes.push(v)},"./forms":{},"./ui":{},"./library-model":{}});
  function Probe(){value=useStored("recipes",[]);return null;}let tree;
  try{
    await renderer.act(()=>{tree=renderer.create(React.createElement(Probe));});
    await renderer.act(()=>value[1](["my edit"]));
    await renderer.act(async()=>{pending.resolve(["old"]);await settle();});
    assert.deepEqual(value[0],["my edit"]);assert.deepEqual(writes,[["my edit"]]);
  }finally{if(tree)await renderer.act(()=>tree.unmount());}
});

test("foreground reminders use the shared event ledger, not status transitions", async () => {
  let entries=[], callback, shown=[], claims=new Set(), baseline=false;
  const rn={...native,AppState:{currentState:"active",addEventListener:(_,fn)=>{callback=fn;return{remove(){}};}}};
  const {useNoticeFeed}=load("src/use-notice-feed.ts",{"react-native":rn,"./cache":{},"./notice-feed":load("src/notice-feed.ts",{}),"./transport":{
    api:async()=>({items:entries}),baselineNotices:async(_fp,ids)=>{if(baseline)return false;baseline=true;ids.forEach(id=>claims.add(id));return true;},claimNotices:async(_fp,ids)=>{const fresh=ids.filter(id=>!claims.has(id));ids.forEach(id=>claims.add(id));return fresh;}
  }});
  let client={host:host(),connection:{phase:"online"},sessions:[{id:"s",title:"Review",status:"working"}],sessionId:"",setNotice:(...args)=>shown.push(args)};
  const prefs={completion:true,failure:true,attention:true,muted:[]};
  function Probe(){useNoticeFeed(client,prefs,true);return null;}let tree;
  try{
    await renderer.act(async()=>{tree=renderer.create(React.createElement(Probe));await settle();});
    client={...client,sessions:[{...client.sessions[0],status:"idle"}]};
    await renderer.act(async()=>{tree.update(React.createElement(Probe));callback("active");await settle();});assert.equal(shown.length,0);
    entries=[{id:"n",kind:"completion",title:"Complete",sessionId:"s"}];
    await renderer.act(async()=>{callback("active");await settle();});assert.equal(shown.length,1);
    await renderer.act(async()=>{callback("active");await settle();});assert.equal(shown.length,1);
    claims.add("background-notice");entries.push({id:"background-notice",kind:"completion",title:"already shown"});
    await renderer.act(async()=>{callback("active");await settle();});assert.equal(shown.length,1);
  }finally{if(tree)await renderer.act(()=>tree.unmount());}
});

test("invalid image-cache metadata forces a fresh verified download bound to the captured computer", async () => {
  const owners=[],downloads=[],writes=[];
  const {requestCached}=load("src/media-cache.ts",{"react-native":native,"expo-crypto":{CryptoDigestAlgorithm:{SHA256:"sha"},digestStringAsync:async()=>"cache-id"},"expo-file-system/legacy":{cacheDirectory:"file:///cache/",getInfoAsync:async()=>({exists:true,size:20}),readAsStringAsync:async()=>"broken json",writeAsStringAsync:async(...args)=>writes.push(args)},"./transport":{api:async h=>{owners.push(h.fingerprint);return{ticket:"media",name:"photo.png"};},downloadAsset:async(h,p,d)=>{downloads.push(h.fingerprint);return d;},wifiAvailable:async()=>true},"./request-queue":load("src/request-queue.ts",{}),"./transfers":{trackTransfer(){},transfersSnapshot:()=>[]}});
  const a=host(), client={host:a};
  const ticket=requestCached(client,"grok-media://access/picture","original",0);
  client.host=host("b");
  await ticket.promise;
  assert.deepEqual(owners,[a.fingerprint]);assert.deepEqual(downloads,[a.fingerprint]);assert.equal(writes.length,1);
});

test("a recycled photo cell never displays the previous source while its replacement is loading", async () => {
  const a=deferred(),b=deferred();let current="grok-media://access/a", state;
  const {useCachedImage}=load("src/media-cache.ts",{"react-native":native,"expo-crypto":{CryptoDigestAlgorithm:{SHA256:"sha"},digestStringAsync:async(_,s)=>s.includes('/a?')?'a':'b'},"expo-file-system/legacy":{cacheDirectory:"file:///cache/",getInfoAsync:async()=>({exists:false}),writeAsStringAsync:async()=>{}},"./transport":{api:async(_h,p)=>({ticket:new URL(new URL(p,'https://fixture.invalid').searchParams.get('source')).pathname==='/a'?'a':'b'}),downloadAsset:async(_h,p)=>p.includes('/a/')?a.promise:b.promise,wifiAvailable:async()=>true},"./request-queue":load("src/request-queue.ts",{}),"./transfers":{trackTransfer(){},transfersSnapshot:()=>[]}});
  const client={host:host()};function Probe(){state=useCachedImage(client,current,"thumbnail");return null;}let tree;
  try{
    await renderer.act(async()=>{tree=renderer.create(React.createElement(Probe));await settle();a.resolve("file://a");await settle();});assert.equal(state.uri,"file://a");
    await renderer.act(async()=>{current="grok-media://access/b";tree.update(React.createElement(Probe));await settle();});assert.equal(state.uri,"");
    await renderer.act(async()=>{b.resolve("file://b");await settle();});assert.equal(state.uri,"file://b");
  }finally{if(tree)await renderer.act(()=>tree.unmount());}
});
