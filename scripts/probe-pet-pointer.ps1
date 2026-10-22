param([Parameter(Mandatory=$true)][int]$X,[Parameter(Mandatory=$true)][int]$Y,[long]$VerifyWindow=0)
$ErrorActionPreference='Stop'
# Only used by the isolated Electron fixture, on its own verification surface.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PetProbePointer {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool GetPhysicalCursorPos(out Point point);
 [DllImport("user32.dll")] public static extern bool SetPhysicalCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window,int index);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window,System.Text.StringBuilder text,int size);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out int value,int size);
}
'@
$PreviousPointer=New-Object PetProbePointer+Point
[void][PetProbePointer]::GetPhysicalCursorPos([ref]$PreviousPointer)
try {
 if(-not [PetProbePointer]::SetPhysicalCursorPos($X,$Y)){throw 'Cannot position pointer on test surface'}
 Start-Sleep -Milliseconds 220
 $ActualPointer=New-Object PetProbePointer+Point
 [void][PetProbePointer]::GetPhysicalCursorPos([ref]$ActualPointer)
 $PointerWindow=[PetProbePointer]::GetAncestor([PetProbePointer]::WindowFromPoint($ActualPointer),2)
 $WindowClass=New-Object Text.StringBuilder 256
 [void][PetProbePointer]::GetClassName($PointerWindow,$WindowClass,256)
 $VerifiedRect=New-Object PetProbePointer+Rect
 [void][PetProbePointer]::GetWindowRect([IntPtr]$VerifyWindow,[ref]$VerifiedRect)
 $Cloaked=0
 [void][PetProbePointer]::DwmGetWindowAttribute([IntPtr]$VerifyWindow,14,[ref]$Cloaked,4)
 @{X=$ActualPointer.X;Y=$ActualPointer.Y;Window=$PointerWindow.ToInt64();Class=$WindowClass.ToString();VerifyRect=$VerifiedRect;Cloaked=$Cloaked;Foreground=[PetProbePointer]::GetForegroundWindow().ToInt64()} | ConvertTo-Json -Compress
 [PetProbePointer]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 45
 [PetProbePointer]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 100
} finally { [void][PetProbePointer]::SetPhysicalCursorPos($PreviousPointer.X,$PreviousPointer.Y) }
