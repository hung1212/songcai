import AppKit
import ApplicationServices
import Vision
import ImageIO

// Local helper for user-selected WeChat windows and saved images. No database,
// message sending, account credentials or network access is used here.
struct ReaderError: Error { let message: String }
func fail(_ text: String) throws -> Never { throw ReaderError(message: text) }
func wechatWindows() -> [[String: Any]] {
    let apps = NSWorkspace.shared.runningApplications.filter { ["com.tencent.xinWeChat", "com.tencent.WeChat"].contains($0.bundleIdentifier ?? "") }
    let pids = Set(apps.map { Int($0.processIdentifier) })
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return windows.compactMap { row in
        guard let pid = row[kCGWindowOwnerPID as String] as? Int, pids.contains(pid),
              let id = row[kCGWindowNumber as String] as? Int,
              let bounds = row[kCGWindowBounds as String] as? [String: CGFloat],
              (row[kCGWindowLayer as String] as? Int ?? -1) == 0,
              (bounds["Width"] ?? 0) > 180, (bounds["Height"] ?? 0) > 150 else { return nil }
        return ["id": String(id), "pid": pid, "name": row[kCGWindowName as String] as? String ?? "微信窗口", "bounds": bounds]
    }
}
func target(_ request: [String: Any]) throws -> [String: Any] {
    guard let id = request["windowId"] as? String,
          let window = wechatWindows().first(where: { $0["id"] as? String == id }),
          let pid = window["pid"] as? Int, pid == request["pid"] as? Int else { try fail("目标微信窗口已关闭、最小化或发生变化，请重新选择") }
    return window
}
// Accurate Chinese recognition can discard spaces. Keep its text intact and
// return independent Latin word/character geometry for conservative recovery.
func pixelBox(_ box: CGRect, _ image: CGImage) -> [String: Double] {
    return ["x": Double(box.minX) * Double(image.width), "y": Double(1 - box.maxY) * Double(image.height),
            "width": Double(box.width) * Double(image.width), "height": Double(box.height) * Double(image.height)]
}
func ranges(_ item: VNRecognizedText, pattern: String, image: CGImage) -> [[String: Any]] {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
    return regex.matches(in: item.string, range: NSRange(item.string.startIndex..., in: item.string)).compactMap { match in
        guard let range = Range(match.range, in: item.string), let box = try? item.boundingBox(for: range) else { return nil }
        return ["text": String(item.string[range]), "start": match.range.location, "end": NSMaxRange(match.range), "box": pixelBox(box.boundingBox, image)]
    }
}
func recognize(_ image: CGImage, languages: [String], level: VNRequestTextRecognitionLevel) throws -> [VNRecognizedTextObservation] {
    let operation = VNRecognizeTextRequest()
    operation.recognitionLevel = level
    operation.recognitionLanguages = languages
    operation.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([operation])
    return operation.results as? [VNRecognizedTextObservation] ?? []
}
func handle(_ request: [String: Any]) throws -> [String: Any] {
    switch request["command"] as? String ?? "" {
    case "status":
        return ["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess(), "ocr": true]
    case "windows":
        return ["windows": wechatWindows()]
    case "focus":
        guard AXIsProcessTrusted() else { try fail("请先为松财开启辅助功能权限，然后重新打开松财") }
        let window = try target(request)
        guard let pid = window["pid"] as? Int, let app = NSRunningApplication(processIdentifier: pid_t(pid)), app.activate(options: [.activateIgnoringOtherApps]) else { try fail("无法激活目标微信窗口") }
        let root = AXUIElementCreateApplication(pid_t(pid))
        var elements: CFTypeRef?
        AXUIElementCopyAttributeValue(root, kAXWindowsAttribute as CFString, &elements)
        // Raise only a uniquely matching window title. The Electron preview and
        // subsequent PID/window checks remain required if titles are ambiguous.
        if let windows = elements as? [AXUIElement], let name = window["name"] as? String {
            let matches = windows.filter { element in
                var title: CFTypeRef?
                AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &title)
                return (title as? String) == name
            }
            if matches.count == 1 { AXUIElementPerformAction(matches[0], kAXRaiseAction as CFString) }
        }
        return ["ok": true]
    case "check", "scroll":
        let window = try target(request)
        guard let pid = window["pid"] as? Int, NSWorkspace.shared.frontmostApplication?.processIdentifier == pid_t(pid) else { try fail("微信已失去前台，采集暂停；已保存的页面不会丢失") }
        guard wechatWindows().first?["id"] as? String == window["id"] as? String else { try fail("目标收藏不在微信最前方，采集暂停，请重新打开目标窗口") }
        if let expected = request["title"] as? String, window["name"] as? String != expected { try fail("微信窗口标题已变化，请核对是否切换了收藏") }
        let bounds = window["bounds"] as! [String: CGFloat]
        if let expected = request["bounds"] as? [String: CGFloat], ["X", "Y", "Width", "Height"].contains(where: { abs((expected[$0] ?? 0) - (bounds[$0] ?? 0)) > 2 }) { try fail("窗口位置或大小改变，采集暂停，请重新预览并框选") }
        if request["command"] as? String == "check" { return ["ok": true] }
        guard AXIsProcessTrusted(), let crop = request["crop"] as? [String: Double] else { try fail("缺少辅助功能权限或正文区域") }
        let relativeX: Double = (crop["x"] ?? 0) + (crop["width"] ?? 0) / 2.0
        let relativeY: Double = (crop["y"] ?? 0) + (crop["height"] ?? 0) / 2.0
        let x: Double = Double(bounds["X"] ?? 0) + Double(bounds["Width"] ?? 0) * relativeX
        let y: Double = Double(bounds["Y"] ?? 0) + Double(bounds["Height"] ?? 0) * relativeY
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
                                  wheel1: -Int32(Double(bounds["Height"] ?? 0) * (crop["height"] ?? 0) * 0.62), wheel2: 0, wheel3: 0) else { try fail("无法创建滚动事件") }
        event.location = CGPoint(x: x, y: y)
        event.postToPid(pid_t(pid))
        return ["ok": true]
    case "ocr":
        guard let filename = request["path"] as? String else { try fail("缺少图片") }
        let url = URL(fileURLWithPath: filename)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { try fail("图片无法读取") }
        let observations = try recognize(image, languages: ["zh-Hans", "zh-Hant", "en-US"], level: .accurate)
        let rows: [[String: Any]] = observations.compactMap { observation in
            guard let item = observation.topCandidates(1).first else { return nil }
            return ["text": item.string, "confidence": Double(item.confidence), "x": Double(observation.boundingBox.minX),
                    "y": Double(1 - observation.boundingBox.maxY), "width": Double(observation.boundingBox.width), "height": Double(observation.boundingBox.height),
                    "box": pixelBox(observation.boundingBox, image), "runs": ranges(item, pattern: "[0-9]+", image: image)]
        }.sorted { ($0["y"] as! Double, $0["x"] as! Double) < ($1["y"] as! Double, $1["x"] as! Double) }
        var evidence: [String: Any] = [:]
        if rows.contains(where: { ($0["text"] as? String ?? "").range(of: "[0-9]{2}", options: .regularExpression) != nil }) {
            do {
                for (key, level, pattern) in [("wordLines", VNRequestTextRecognitionLevel.accurate, "[0-9]+"), ("characterLines", .fast, "[0-9Il|]")] {
                    evidence[key] = try recognize(image, languages: ["en-US"], level: level).compactMap { observation -> [String: Any]? in
                        guard let item = observation.topCandidates(1).first else { return nil }
                        return ["text": item.string, "box": pixelBox(observation.boundingBox, image), "tokens": ranges(item, pattern: pattern, image: image)]
                    }
                }
            } catch {
                evidence["warning"] = "数字间距复核未完成，请对照原图核对号码空格"
            }
        }
        return ["text": rows.compactMap { $0["text"] as? String }.joined(separator: "\n"), "lines": rows, "spacingEvidence": evidence, "engine": "macOS Vision"]
    default: try fail("未知操作")
    }
}
do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { try fail("请求格式无效") }
    let result = try handle(request)
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
} catch {
    let message = (error as? ReaderError)?.message ?? error.localizedDescription
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ["error": message]))
    exit(1)
}
