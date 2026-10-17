$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  if ($request.command -eq 'ocr') {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    function Await-WinRT($operation, [Type]$resultType) {
      $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
      $task.Wait()
      return $task.Result
    }
    $file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($request.path)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $languages = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
      $chinese = $languages | Where-Object { $_.LanguageTag -like 'zh-*' } | Select-Object -First 1
      if (!$chinese) { throw 'Windows 未安装中文 OCR 语言资源；请在系统语言设置安装中文语言包，或手动填写识别文本' }
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($chinese)
      if ($bitmap.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $bitmap.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { throw '图片超过系统 OCR 尺寸上限，请拆分长图后重新导入' }
      $result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      @{text=($result.Lines.Text -join "`n"); lines=@(); engine='Windows OCR'} | ConvertTo-Json -Depth 5 -Compress
      $bitmap.Dispose()
    } finally { $stream.Dispose() }
    exit 0
  }
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WechatWindow {
  public string id; public int pid; public string name; public Dictionary<string,int> bounds;
}
public static class WechatReader {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder b, int size);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  public static List<WechatWindow> List(int[] pids) {
    SetProcessDPIAware();
    var found = new List<WechatWindow>();
    EnumWindows((h, p) => {
      int pid; GetWindowThreadProcessId(h, out pid); Rect r;
      if (Array.IndexOf(pids, pid) >= 0 && IsWindowVisible(h) && GetWindowRect(h, out r) && r.Right-r.Left > 180 && r.Bottom-r.Top > 150) {
        var b = new StringBuilder(512); GetWindowText(h,b,512);
        found.Add(new WechatWindow { id=h.ToInt64().ToString(), pid=pid, name=b.ToString(), bounds=new Dictionary<string,int> {{"X",r.Left},{"Y",r.Top},{"Width",r.Right-r.Left},{"Height",r.Bottom-r.Top}} });
      } return true;
    }, IntPtr.Zero); return found;
  }
}
'@
  if ($request.command -eq 'status') { @{accessibility=$true; screen=$true; ocr=$true} | ConvertTo-Json -Compress; exit 0 }
  $processIds = @(Get-Process -Name WeChat,Weixin -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $windows = @([WechatReader]::List([int[]]$processIds))
  if ($request.command -eq 'windows') { @{windows=$windows} | ConvertTo-Json -Depth 6 -Compress; exit 0 }
  $window = $windows | Where-Object { $_.id -eq $request.windowId -and $_.pid -eq $request.pid } | Select-Object -First 1
  if (!$window) { throw '目标微信窗口已关闭、最小化或发生变化，请重新选择' }
  $handle = [IntPtr]([long]$window.id)
  if ($request.command -eq 'focus') {
    if (![WechatReader]::SetForegroundWindow($handle)) { throw '无法激活微信，请手动打开目标收藏后重试' }
  } elseif ($request.command -eq 'check' -or $request.command -eq 'scroll') {
    if ([WechatReader]::GetForegroundWindow() -ne $handle) { throw '目标微信窗口已失去前台，采集暂停' }
    if ($request.title -ne $window.name) { throw '目标窗口标题变化，采集暂停' }
    foreach ($key in @('X','Y','Width','Height')) { if ([Math]::Abs($request.bounds.$key - $window.bounds[$key]) -gt 2) { throw '窗口位置或大小改变，请重新预览框选' } }
    if ($request.command -eq 'scroll') {
      $x = $window.bounds.X + $window.bounds.Width * ($request.crop.x + $request.crop.width / 2)
      $y = $window.bounds.Y + $window.bounds.Height * ($request.crop.y + $request.crop.height / 2)
      $null = [WechatReader]::SetCursorPos([int]$x,[int]$y)
      [WechatReader]::mouse_event(0x0800,0,0,-360,[UIntPtr]::Zero)
    }
  } else { throw '未知操作' }
  @{ok=$true} | ConvertTo-Json -Compress
} catch {
  @{error=$_.Exception.Message} | ConvertTo-Json -Compress
  exit 1
}
