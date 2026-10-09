/**
 * Settings structure, search and the single top suggestion. Kept free of React Native so it
 * runs under Node tests.
 */
export type SettingsPage = "root" | "connection" | "accounts" | "desktop" | "notifications" | "reading" | "gestures" | "security" | "storage" | "updates" | "about";
export type Scope = "这台电脑" | "这部手机";

export const settingsPages: Record<Exclude<SettingsPage, "root">, { title: string; scope: Scope; detail: string }> = {
    connection: { title: "连接与诊断", scope: "这台电脑", detail: "状态、延迟、地址、其他电脑" },
    accounts: { title: "电脑账号", scope: "这台电脑", detail: "查看与切换电脑上的账号" },
    desktop: { title: "电脑与 CLI 版本", scope: "这台电脑", detail: "检查电脑端更新" },
    notifications: { title: "通知与后台", scope: "这部手机", detail: "系统通知、后台跟进、免打扰" },
    reading: { title: "阅读与外观", scope: "这部手机", detail: "主题、字号、回答详细程度" },
    gestures: { title: "手势与触感", scope: "这部手机", detail: "滑动、长按、触感反馈" },
    security: { title: "安全", scope: "这部手机", detail: "应用锁、防截屏" },
    storage: { title: "存储与传输", scope: "这部手机", detail: "缓存占用、传输中心" },
    updates: { title: "手机更新", scope: "这部手机", detail: "检查并安装新版本" },
    about: { title: "关于与诊断", scope: "这部手机", detail: "版本、诊断、键盘模式" },
};

const entries: Array<{ title: string; keywords: string; page: Exclude<SettingsPage, "root"> }> = [
    { title: "连接状态与延迟", keywords: "连接 状态 延迟 ping 测试 诊断 离线 连不上", page: "connection" },
    { title: "连接地址", keywords: "地址 ip 网络 重新发现 局域网 vpn 改地址", page: "connection" },
    { title: "其他电脑 / 添加电脑", keywords: "配对 扫码 切换 电脑 添加", page: "connection" },
    { title: "忘记这台电脑", keywords: "忘记 删除 解除配对", page: "connection" },
    { title: "电脑账号", keywords: "账号 切换 登录 账户", page: "accounts" },
    { title: "电脑与 CLI 版本", keywords: "desktop cli 版本 电脑更新", page: "desktop" },
    { title: "系统通知权限", keywords: "通知 权限 提醒 关闭 渠道", page: "notifications" },
    { title: "后台持续跟进", keywords: "后台 常驻 跟进 耗电 电池 wifi 亮屏 被杀", page: "notifications" },
    { title: "电池优化", keywords: "电池 优化 省电 后台 被杀", page: "notifications" },
    { title: "免打扰时段", keywords: "免打扰 夜间 安静 睡眠", page: "notifications" },
    { title: "应用内提示", keywords: "提示 横幅 应用内 提醒", page: "notifications" },
    { title: "测试通知", keywords: "测试 通知 收不到", page: "notifications" },
    { title: "云端推送", keywords: "fcm 推送 firebase", page: "notifications" },
    { title: "主题", keywords: "深色 浅色 外观 主题 夜间模式", page: "reading" },
    { title: "字号", keywords: "字号 字体 大小 阅读 看不清", page: "reading" },
    { title: "回答详细程度", keywords: "简约 详细 工具 密度", page: "reading" },
    { title: "触感反馈", keywords: "震动 触感 振动 haptic", page: "gestures" },
    { title: "滑动与长按", keywords: "手势 滑动 长按 收藏 归档 引用", page: "gestures" },
    { title: "应用锁", keywords: "锁 指纹 面容 密码 安全 隐私", page: "security" },
    { title: "防截屏", keywords: "截图 截屏 最近任务 隐私", page: "security" },
    { title: "缓存", keywords: "缓存 清理 存储 空间 占用", page: "storage" },
    { title: "传输中心", keywords: "下载 上传 传输 重试 原图 失败", page: "storage" },
    { title: "手机更新", keywords: "更新 升级 apk 版本 新版", page: "updates" },
    { title: "导出诊断", keywords: "诊断 日志 反馈 问题", page: "about" },
    { title: "键盘模式", keywords: "键盘 输入法 遮挡 挡住", page: "about" },
    { title: "版本与能力", keywords: "版本 关于 能力", page: "about" },
];

/** Search by title and natural keywords; results name their place and scope. */
export function searchSettings(query: string) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return entries
        .map(entry => ({ entry, hay: (entry.title + " " + entry.keywords).toLowerCase() }))
        .filter(({ hay }) => terms.every(term => hay.includes(term)))
        .map(({ entry }) => ({ ...entry, place: `${settingsPages[entry.page].scope} → ${settingsPages[entry.page].title}` }));
}

export interface SuggestionInput {
    notificationsEnabled?: boolean;
    following: boolean;
    batteryExempt?: boolean;
    lockEnabled: boolean;
    autoMode: boolean;
    updateVersion?: string;
    dismissed: string[];
}
export interface Suggestion { id: string; title: string; detail: string; action: string; tone: "warning" | "info" }

/** At most one suggestion at a time, most consequential first; each can be dismissed. */
export function pickSuggestion(input: SuggestionInput): Suggestion | undefined {
    const all: Suggestion[] = [];
    if (input.notificationsEnabled === false) all.push({ id: "notifications-off", tone: "warning", title: "系统通知已关闭", detail: "App 里仍有提示，但手机在后台时收不到完成和审批通知。", action: "去开启" });
    if (input.following && input.batteryExempt === false) all.push({ id: "battery", tone: "warning", title: "后台跟进可能被系统停止", detail: "允许 Grok Remote 忽略电池优化，后台跟进才能稳定运行。", action: "允许" });
    if (!input.lockEnabled && input.autoMode) all.push({ id: "lock-auto", tone: "warning", title: "建议开启应用锁", detail: "这台电脑使用了自动批准模式，拿到手机的人可以直接让电脑执行命令。", action: "开启" });
    if (input.updateVersion) all.push({ id: "update:" + input.updateVersion, tone: "info", title: `Grok Remote ${input.updateVersion} 可用`, detail: "下载后校验签名，由系统确认安装，配对和草稿保留。", action: "查看" });
    if (!input.lockEnabled && !input.autoMode) all.push({ id: "lock", tone: "info", title: "可以开启应用锁", detail: "用指纹或手机锁屏密码保护对电脑的控制。", action: "开启" });
    return all.find(s => !input.dismissed.includes("suggest:" + s.id));
}

export function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatAgo(timestamp: number, now = Date.now()) {
    if (!timestamp) return "尚未同步";
    const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
    if (seconds < 10) return "刚刚";
    if (seconds < 60) return `${seconds} 秒前`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
    return `${Math.round(seconds / 3600)} 小时前`;
}

export function minutesLabel(value: number) {
    const h = Math.floor(value / 60) % 24, m = value % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Text the user can paste to Grok on the computer; contains no addresses, tokens or content. */
export function diagnosticPrompt(input: { phase: string; detail?: string; mobileVersion: string; desktopVersion?: string; mode?: string }) {
    return [
        "我的手机 Grok Remote 连不上这台电脑上的 Grok Build Desktop，请帮我排查：",
        `- 手机端状态：${input.phase}${input.detail ? `（${input.detail}）` : ""}`,
        `- 手机版本：${input.mobileVersion}；配套电脑版本：${input.desktopVersion || "未知"}`,
        "请检查：Grok Build Desktop 是否在运行、远程连接是否开启、Windows 防火墙是否放行、电脑当前局域网地址是否变化，以及应用日志里最近的远程连接错误，然后告诉我该怎么修。",
    ].join("\n");
}
