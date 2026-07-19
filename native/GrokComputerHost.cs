// Clean-room Windows UI Automation helper for Grok Build Desktop.
// JSON-lines protocol over stdin/stdout. Never connects to the network.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

internal static class GrokComputerHost
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024, RecursionLimit = 80 };
    private static readonly Dictionary<string, AutomationElement> Elements = new Dictionary<string, AutomationElement>();
    private static readonly Dictionary<IntPtr, string> LatestStates = new Dictionary<IntPtr, string>();
    private static readonly HashSet<string> BlockedProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "grok build desktop", "grok-build-desktop", "codex", "chatgpt", "powershell", "pwsh", "cmd", "windowsterminal", "wt", "conhost"
    };

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--self-test") {
            Console.WriteLine(Json.Serialize(new Dictionary<string, object> { { "ok", true }, { "version", "0.3.1" }, { "platform", Environment.Is64BitProcess ? "win-x64" : "win-x86" } }));
            return Environment.Is64BitProcess ? 0 : 2;
        }
        Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
        string line;
        while ((line = Console.ReadLine()) != null) {
            if (String.IsNullOrWhiteSpace(line)) continue;
            object id = null;
            try {
                Dictionary<string, object> request = Json.Deserialize<Dictionary<string, object>>(line);
                request.TryGetValue("id", out id);
                string action = StringValue(request, "action");
                Dictionary<string, object> input = request.ContainsKey("input") ? request["input"] as Dictionary<string, object> : null;
                if (input == null) input = new Dictionary<string, object>();
                object result = Execute(action, input);
                Write(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "result", result } });
            } catch (Exception ex) {
                Write(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", ex.Message } });
            }
        }
        return 0;
    }

    private static object Execute(string action, Dictionary<string, object> input)
    {
        if (action == "self_test") return new Dictionary<string, object> { { "version", "0.3.1" }, { "x64", Environment.Is64BitProcess } };
        if (!IsInteractiveDefaultDesktop()) throw new InvalidOperationException("当前不是已解锁的前台 Default 桌面；Computer Use 已停止");
        if (action == "list_windows" || action == "list_apps") return EnumerateWindows();
        if (action == "get_cursor_position") { POINT cursor; if (!GetCursorPos(out cursor)) throw new InvalidOperationException("无法读取系统鼠标位置"); return new Dictionary<string, object> { { "x", cursor.X }, { "y", cursor.Y } }; }
        if (action == "wait") { Thread.Sleep(Math.Max(0, Math.Min(30000, IntValue(input, "milliseconds", 500)))); return new Dictionary<string, object> { { "waited", true } }; }
        if (action == "launch_app") { string path = StringValue(input, "executablePath"); if (String.IsNullOrEmpty(path) || !File.Exists(path)) throw new InvalidOperationException("缺少已验证的应用路径"); Process.Start(path); return new Dictionary<string, object> { { "launched", true } }; }
        IntPtr hwnd = ParseHwnd(StringValue(input, "windowId"));
        EnsureWindow(hwnd);
        if (action == "activate_window") { Activate(hwnd); return WindowInfo(hwnd); }
        if (action == "get_window_state") return CaptureState(hwnd, IntValue(input, "maxEdge", 1600), input);
        RequireFreshState(hwnd, StringValue(input, "stateId"));
        EnsureForeground(hwnd);
        if (action == "click" || action == "double_click" || action == "perform_secondary_action") {
            AutomationElement element = FindElement(StringValue(input, "elementId"));
            // Use UI Automation only to locate the element. The actual action is
            // a visible system-pointer operation so the user can follow control.
            Point point = TargetPoint(hwnd, input, element);
            if (!SetCursorPos(point.X, point.Y)) throw new InvalidOperationException("Windows 拒绝移动系统鼠标");
            Thread.Sleep(180);
            uint down = action == "perform_secondary_action" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
            uint up = action == "perform_secondary_action" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
            mouse_event(down, 0, 0, 0, UIntPtr.Zero); mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            if (action == "double_click") { Thread.Sleep(60); mouse_event(down, 0, 0, 0, UIntPtr.Zero); mouse_event(up, 0, 0, 0, UIntPtr.Zero); }
        } else if (action == "scroll") {
            AutomationElement element = FindElement(StringValue(input, "elementId"));
            int delta = IntValue(input, "deltaY", -480);
            if (!TryScroll(element, delta)) {
                Point point = TargetPoint(hwnd, input, element); SetCursorPos(point.X, point.Y);
                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
            }
        } else if (action == "press_key") {
            PressKey(StringValue(input, "key"));
        } else if (action == "type_text") {
            SendUnicode(StringValue(input, "text"));
        } else if (action == "set_value") {
            AutomationElement element = FindElement(StringValue(input, "elementId"));
            if (element == null || !TrySetValue(element, StringValue(input, "value"))) throw new InvalidOperationException("目标不支持 ValuePattern；请重新观察并使用点击后输入");
        } else if (action == "drag") {
            Point start = TargetPoint(hwnd, input, FindElement(StringValue(input, "elementId")));
            RECT rect; GetWindowRect(hwnd, out rect);
            int endX = input.ContainsKey("endX") ? rect.Left + IntValue(input, "endX", 0) : start.X;
            int endY = input.ContainsKey("endY") ? rect.Top + IntValue(input, "endY", 0) : start.Y;
            SetCursorPos(start.X, start.Y); mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(80);
            SetCursorPos(endX, endY); Thread.Sleep(100); mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        } else throw new InvalidOperationException("Unsupported action: " + action);
        Thread.Sleep(120);
        return CaptureState(hwnd, IntValue(input, "maxEdge", 1600), input);
    }

    private static List<object> EnumerateWindows()
    {
        List<object> rows = new List<object>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr ignored) {
            if (!IsWindowVisible(hwnd)) return true;
            StringBuilder title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
            if (title.Length == 0) return true;
            RECT rect; if (!GetWindowRect(hwnd, out rect) || rect.Right <= rect.Left || rect.Bottom <= rect.Top) return true;
            rows.Add(WindowInfo(hwnd)); return true;
        }, IntPtr.Zero);
        return rows;
    }

    private static Dictionary<string, object> WindowInfo(IntPtr hwnd)
    {
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        string processName = "unknown", path = null;
        try { Process process = Process.GetProcessById((int)pid); processName = process.ProcessName; try { path = process.MainModule.FileName; } catch { } } catch { }
        StringBuilder title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
        RECT rect; GetWindowRect(hwnd, out rect);
        bool elevated = IsProcessElevated(pid);
        bool blocked = IsBlocked(processName, title.ToString()) || elevated;
        return new Dictionary<string, object> {
            { "id", HwndString(hwnd) }, { "appId", processName.ToLowerInvariant() }, { "processId", (int)pid }, { "processName", processName },
            { "executablePath", path }, { "title", title.ToString() }, { "x", rect.Left }, { "y", rect.Top }, { "width", rect.Right - rect.Left }, { "height", rect.Bottom - rect.Top },
            { "dpi", GetDpi(hwnd) }, { "minimized", IsIconic(hwnd) }, { "foreground", GetForegroundWindow() == hwnd }, { "controllable", !blocked },
            { "blockedReason", elevated ? "目标窗口运行于更高权限级别" : blocked ? "该应用位于 Computer Use 不可控制清单" : null }
        };
    }

    private static Dictionary<string, object> CaptureState(IntPtr hwnd, int maxEdge, Dictionary<string, object> input)
    {
        EnsureWindow(hwnd);
        RECT rect; GetWindowRect(hwnd, out rect);
        int width = Math.Max(1, rect.Right - rect.Left), height = Math.Max(1, rect.Bottom - rect.Top);
        double screenshotScale = Math.Min(1.0, (double)Math.Max(640, Math.Min(2000, maxEdge)) / Math.Max(width, height));
        int screenshotWidth = Math.Max(1, (int)(width * screenshotScale)), screenshotHeight = Math.Max(1, (int)(height * screenshotScale));
        string stateId = Guid.NewGuid().ToString("N"); LatestStates[hwnd] = stateId;
        // Keep element handles from other windows long enough for concurrent sessions.
        // The main process and LatestStates still enforce one-use, latest-state actions.
        if (Elements.Count > 5000) Elements.Clear();
        List<object> elements = CaptureElements(hwnd, rect);
        string screenshot = CapturePng(hwnd, width, height, Math.Max(640, Math.Min(2000, maxEdge)));
        Dictionary<string, object> result = new Dictionary<string, object> { { "stateId", stateId }, { "capturedAt", DateTime.UtcNow.ToString("o") }, { "window", WindowInfo(hwnd) }, { "elements", elements }, { "treeTruncated", elements.Count >= 240 }, { "screenshot", screenshot }, { "screenshotMimeType", "image/png" }, { "screenshotSource", "print-window" }, { "screenshotWidth", screenshotWidth }, { "screenshotHeight", screenshotHeight }, { "coordinateSpace", "screenshot-pixels" } };
        int detailWidth = IntValue(input, "detailWidth", 0), detailHeight = IntValue(input, "detailHeight", 0);
        if (detailWidth > 0 && detailHeight > 0) {
            int detailX = Math.Max(0, IntValue(input, "detailX", 0)), detailY = Math.Max(0, IntValue(input, "detailY", 0));
            detailWidth = Math.Min(detailWidth, width - detailX); detailHeight = Math.Min(detailHeight, height - detailY);
            if (detailWidth <= 0 || detailHeight <= 0) throw new InvalidOperationException("局部截图区域超出目标窗口");
            if ((long)detailWidth * detailHeight > 2000000L) throw new InvalidOperationException("局部原图区域不得超过 200 万像素");
            result["detailScreenshot"] = CapturePngRegion(hwnd, width, height, detailX, detailY, detailWidth, detailHeight);
            result["detailRegion"] = new Dictionary<string, object> { { "x", detailX }, { "y", detailY }, { "width", detailWidth }, { "height", detailHeight } };
        }
        return result;
    }

    private static List<object> CaptureElements(IntPtr hwnd, RECT windowRect)
    {
        List<object> output = new List<object>();
        try {
            AutomationElement root = AutomationElement.FromHandle(hwnd);
            Queue<AutomationElement> queue = new Queue<AutomationElement>(); queue.Enqueue(root);
            while (queue.Count > 0 && output.Count < 240) {
                AutomationElement element = queue.Dequeue();
                try {
                    string name = element.Current.Name ?? ""; string type = element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "");
                    System.Windows.Rect bounds = element.Current.BoundingRectangle;
                    bool interactive = element.Current.IsEnabled && (type == "Button" || type == "Edit" || type == "ComboBox" || type == "ListItem" || type == "MenuItem" || type == "CheckBox" || type == "RadioButton" || type == "Hyperlink" || type == "TabItem" || type == "Slider");
                    if (interactive && bounds.Width > 0 && bounds.Height > 0) {
                        string id = Guid.NewGuid().ToString("N"); Elements[id] = element;
                        List<string> patterns = new List<string>(); object pattern;
                        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) patterns.Add("Invoke");
                        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) patterns.Add("Value");
                        if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) patterns.Add("ScrollItem");
                        string currentValue = null;
                        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) { try { currentValue = ((ValuePattern)pattern).Current.Value; } catch { } }
                        output.Add(new Dictionary<string, object> { { "elementId", id }, { "name", name }, { "controlType", type }, { "value", currentValue }, { "enabled", true }, { "x", (int)bounds.X }, { "y", (int)bounds.Y }, { "width", (int)bounds.Width }, { "height", (int)bounds.Height }, { "patterns", patterns } });
                    }
                    AutomationElement child = TreeWalker.ControlViewWalker.GetFirstChild(element);
                    int children = 0;
                    while (child != null && children++ < 60) { queue.Enqueue(child); child = TreeWalker.ControlViewWalker.GetNextSibling(child); }
                } catch (ElementNotAvailableException) { }
            }
        } catch { }
        return output;
    }

    private static string CapturePng(IntPtr hwnd, int width, int height, int maxEdge)
    {
        using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
            using (Graphics graphics = Graphics.FromImage(bitmap)) {
                IntPtr hdc = graphics.GetHdc(); bool ok = PrintWindow(hwnd, hdc, 2); graphics.ReleaseHdc(hdc);
                if (!ok) { RECT rect; GetWindowRect(hwnd, out rect); graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy); }
            }
            Bitmap output = bitmap;
            if (Math.Max(width, height) > maxEdge) {
                double scale = (double)maxEdge / Math.Max(width, height); output = new Bitmap(bitmap, new Size(Math.Max(1, (int)(width * scale)), Math.Max(1, (int)(height * scale))));
            }
            try { using (MemoryStream stream = new MemoryStream()) { output.Save(stream, ImageFormat.Png); return Convert.ToBase64String(stream.ToArray()); } }
            finally { if (!Object.ReferenceEquals(output, bitmap)) output.Dispose(); }
        }
    }

    private static string CapturePngRegion(IntPtr hwnd, int width, int height, int x, int y, int cropWidth, int cropHeight)
    {
        using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
            using (Graphics graphics = Graphics.FromImage(bitmap)) {
                IntPtr hdc = graphics.GetHdc(); bool ok = PrintWindow(hwnd, hdc, 2); graphics.ReleaseHdc(hdc);
                if (!ok) { RECT rect; GetWindowRect(hwnd, out rect); graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy); }
            }
            using (Bitmap crop = bitmap.Clone(new Rectangle(x, y, cropWidth, cropHeight), PixelFormat.Format32bppArgb))
            using (MemoryStream stream = new MemoryStream()) { crop.Save(stream, ImageFormat.Png); return Convert.ToBase64String(stream.ToArray()); }
        }
    }

    private static bool TryInvoke(AutomationElement element) { try { object pattern; if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { ((InvokePattern)pattern).Invoke(); return true; } } catch { } return false; }
    private static bool TrySetValue(AutomationElement element, string value) { try { object pattern; if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) { ((ValuePattern)pattern).SetValue(value); return true; } } catch { } return false; }
    private static bool TryScroll(AutomationElement element, int delta) {
        if (element == null) return false;
        try {
            object pattern;
            if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) { ((ScrollItemPattern)pattern).ScrollIntoView(); return true; }
            AutomationElement current = element;
            for (int depth = 0; depth < 8 && current != null; depth++) {
                if (current.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern)) {
                    ScrollPattern scroll = (ScrollPattern)pattern;
                    if (scroll.Current.VerticallyScrollable) scroll.ScrollVertical(delta < 0 ? ScrollAmount.LargeIncrement : ScrollAmount.LargeDecrement);
                    else if (scroll.Current.HorizontallyScrollable) scroll.ScrollHorizontal(delta < 0 ? ScrollAmount.LargeIncrement : ScrollAmount.LargeDecrement);
                    else return false;
                    return true;
                }
                current = TreeWalker.ControlViewWalker.GetParent(current);
            }
        } catch { }
        return false;
    }
    private static AutomationElement FindElement(string id) { AutomationElement value; return !String.IsNullOrEmpty(id) && Elements.TryGetValue(id, out value) ? value : null; }
    private static Point TargetPoint(IntPtr hwnd, Dictionary<string, object> input, AutomationElement element) { if (element != null) { System.Windows.Rect b = element.Current.BoundingRectangle; return new Point((int)(b.X + b.Width / 2), (int)(b.Y + b.Height / 2)); } RECT rect; GetWindowRect(hwnd, out rect); return new Point(rect.Left + IntValue(input, "x", (rect.Right - rect.Left) / 2), rect.Top + IntValue(input, "y", (rect.Bottom - rect.Top) / 2)); }
    private static void RequireFreshState(IntPtr hwnd, string stateId) { string latest; if (String.IsNullOrEmpty(stateId) || !LatestStates.TryGetValue(hwnd, out latest) || latest != stateId) throw new InvalidOperationException("stateId 已过期；请重新调用 get_window_state"); }
    private static void EnsureWindow(IntPtr hwnd) { if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) throw new InvalidOperationException("目标窗口不存在"); Dictionary<string, object> info = WindowInfo(hwnd); if (!(bool)info["controllable"]) throw new InvalidOperationException((string)info["blockedReason"]); }
    private static void Activate(IntPtr hwnd)
    {
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        else ShowWindow(hwnd, SW_SHOW);

        // SetForegroundWindow is intentionally restricted by Windows. Attach
        // only for the duration of this explicit activation so a helper that
        // was launched from a background Electron/CI process can reliably
        // focus the user-selected window without leaving input queues joined.
        for (int attempt = 0; attempt < 3; attempt++) {
            if (GetForegroundWindow() == hwnd) return;
            IntPtr foreground = GetForegroundWindow();
            uint ignored;
            uint currentThread = GetCurrentThreadId();
            uint targetThread = GetWindowThreadProcessId(hwnd, out ignored);
            uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
            bool attachedForeground = false, attachedTarget = false;
            try {
                if (foregroundThread != 0 && foregroundThread != currentThread) attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
                if (targetThread != 0 && targetThread != currentThread) attachedTarget = AttachThreadInput(currentThread, targetThread, true);
                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);
                SetFocus(hwnd);
            } finally {
                if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
                if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
            }
            Thread.Sleep(120 + attempt * 80);
        }
        if (GetForegroundWindow() != hwnd) throw new InvalidOperationException("Windows 拒绝将目标窗口置于前台");
    }
    private static void EnsureForeground(IntPtr hwnd) { if (GetForegroundWindow() != hwnd) throw new InvalidOperationException("目标窗口不再位于前台；请重新激活并观察"); }
    private static bool IsBlocked(string process, string title) { if (BlockedProcesses.Contains(process)) return true; string joined = (process + " " + title).ToLowerInvariant(); return joined.Contains("grok build desktop") || joined.Contains("windows security") || joined.Contains("user account control"); }
    private static bool IsProcessElevated(uint pid) { IntPtr process = IntPtr.Zero, token = IntPtr.Zero; try { process = OpenProcess(0x1000, false, pid); if (process == IntPtr.Zero || !OpenProcessToken(process, 0x0008, out token)) return false; TOKEN_ELEVATION elevation; int size; if (!GetTokenInformation(token, 20, out elevation, Marshal.SizeOf(typeof(TOKEN_ELEVATION)), out size)) return false; return elevation.TokenIsElevated != 0; } catch { return false; } finally { if (token != IntPtr.Zero) CloseHandle(token); if (process != IntPtr.Zero) CloseHandle(process); } }
    private static bool IsInteractiveDefaultDesktop() { IntPtr desktop = IntPtr.Zero; try { desktop = OpenInputDesktop(0, false, 0x0101); if (desktop == IntPtr.Zero) return false; int needed; GetUserObjectInformation(desktop, 2, null, 0, out needed); if (needed <= 0) return false; StringBuilder name = new StringBuilder(needed); return GetUserObjectInformation(desktop, 2, name, name.Capacity, out needed) && String.Equals(name.ToString(), "Default", StringComparison.OrdinalIgnoreCase); } catch { return false; } finally { if (desktop != IntPtr.Zero) CloseDesktop(desktop); } }
    private static uint GetDpi(IntPtr hwnd) { try { return GetDpiForWindow(hwnd); } catch { return 96; } }
    private static void PressKey(string value) { if (String.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("缺少按键"); string[] parts = value.Split('+'); List<byte> keys = new List<byte>(); foreach (string part in parts) { byte key = VirtualKey(part.Trim()); keybd_event(key, 0, 0, UIntPtr.Zero); keys.Add(key); } for (int i = keys.Count - 1; i >= 0; i--) keybd_event(keys[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero); }
    private static byte VirtualKey(string key) { string upper = key.ToUpperInvariant(); if (upper == "CTRL" || upper == "CONTROL") return 0x11; if (upper == "ALT") return 0x12; if (upper == "SHIFT") return 0x10; if (upper == "ENTER") return 0x0D; if (upper == "TAB") return 0x09; if (upper == "ESC" || upper == "ESCAPE") return 0x1B; if (upper == "SPACE") return 0x20; if (upper == "BACKSPACE") return 0x08; if (upper == "DELETE") return 0x2E; if (upper == "UP") return 0x26; if (upper == "DOWN") return 0x28; if (upper == "LEFT") return 0x25; if (upper == "RIGHT") return 0x27; if (upper.Length == 1) return (byte)upper[0]; throw new InvalidOperationException("不支持的按键: " + key); }
    private static void SendUnicode(string text) { foreach (char c in text) { INPUT[] inputs = new INPUT[2]; inputs[0].type = 1; inputs[0].data.ki.wScan = c; inputs[0].data.ki.dwFlags = KEYEVENTF_UNICODE; inputs[1].type = 1; inputs[1].data.ki.wScan = c; inputs[1].data.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP; if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2) throw new InvalidOperationException("Windows SendInput 失败: " + Marshal.GetLastWin32Error()); } }
    private static IntPtr ParseHwnd(string value) { long parsed; return long.TryParse(value, System.Globalization.NumberStyles.HexNumber, null, out parsed) ? new IntPtr(parsed) : IntPtr.Zero; }
    private static string HwndString(IntPtr value) { return value.ToInt64().ToString("X"); }
    private static string StringValue(Dictionary<string, object> value, string key) { object result; return value != null && value.TryGetValue(key, out result) && result != null ? Convert.ToString(result) : ""; }
    private static int IntValue(Dictionary<string, object> value, string key, int fallback) { object result; if (value != null && value.TryGetValue(key, out result) && result != null) { int parsed; if (Int32.TryParse(Convert.ToString(result), out parsed)) return parsed; } return fallback; }
    private static void Write(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, out TOKEN_ELEVATION tokenInformation, int tokenInformationLength, out int returnLength);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder information, int length, out int needed);
    private const int SW_SHOW = 5, SW_RESTORE = 9; private const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004, MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010, MOUSEEVENTF_WHEEL = 0x0800, KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }
    [StructLayout(LayoutKind.Sequential)] private struct TOKEN_ELEVATION { public int TokenIsElevated; }
}
