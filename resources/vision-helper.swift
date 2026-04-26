import Vision
import CoreGraphics
import Foundation

// ── Helpers ───────────────────────────────────────────────────

func emptyResult() {
    let result: [String: Any] = ["text": "", "labels": [] as [[String: Any]]]
    if let data = try? JSONSerialization.data(withJSONObject: result),
       let str = String(data: data, encoding: .utf8) { print(str) }
}

func printResult(text: String, labels: [[String: Any]] = []) {
    let result: [String: Any] = ["text": text, "labels": labels]
    if let data = try? JSONSerialization.data(withJSONObject: result),
       let str = String(data: data, encoding: .utf8) { print(str) }
}

// ── OCR a single CGImage ──────────────────────────────────────

func ocrImage(_ cgImage: CGImage) -> String {
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    try? handler.perform([request])
    return request.results?
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: " ") ?? ""
}

// ── Render a PDF page to CGImage at 2× for OCR accuracy ──────

func renderPage(_ page: CGPDFPage) -> CGImage? {
    let bounds = page.getBoxRect(.mediaBox)
    let scale: CGFloat = 2.0
    let w = Int(bounds.width * scale)
    let h = Int(bounds.height * scale)
    guard w > 0, h > 0 else { return nil }

    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(
              data: nil, width: w, height: h,
              bitsPerComponent: 8, bytesPerRow: 0,
              space: space,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else { return nil }

    // White background so dark text is readable
    ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    ctx.drawPDFPage(page)
    return ctx.makeImage()
}

// ── PDF mode: OCR up to 30 pages ─────────────────────────────

func processPDF(url: URL) {
    guard let doc = CGPDFDocument(url as CFURL) else { emptyResult(); return }
    let pageCount = min(doc.numberOfPages, 30)
    guard pageCount > 0 else { emptyResult(); return }

    var parts: [String] = []
    for i in 1...pageCount {
        guard let page = doc.page(at: i),
              let img  = renderPage(page) else { continue }
        let text = ocrImage(img)
        if !text.isEmpty { parts.append(text) }
    }
    printResult(text: parts.joined(separator: "\n"))
}

// ── Image mode: OCR + semantic classification ─────────────────

func processImage(url: URL) {
    guard let handler = try? VNImageRequestHandler(url: url, options: [:]) else {
        emptyResult(); return
    }

    let ocrRequest = VNRecognizeTextRequest()
    ocrRequest.recognitionLevel = .accurate
    ocrRequest.usesLanguageCorrection = true

    let classifyRequest = VNClassifyImageRequest()

    try? handler.perform([ocrRequest, classifyRequest])

    let text = ocrRequest.results?
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: " ") ?? ""

    let labels = classifyRequest.results?
        .filter { $0.confidence > 0.05 }
        .prefix(15)
        .map { obs -> [String: Any] in
            let clean = obs.identifier
                .replacingOccurrences(of: "_", with: " ")
                .replacingOccurrences(of: "(", with: "")
                .replacingOccurrences(of: ")", with: "")
                .trimmingCharacters(in: .whitespaces)
            return ["label": clean, "confidence": Double(obs.confidence)]
        } ?? []

    printResult(text: text, labels: Array(labels))
}

// ── Entry point ───────────────────────────────────────────────

guard CommandLine.arguments.count > 1 else { emptyResult(); exit(0) }

let inputPath = CommandLine.arguments[1]
let url = URL(fileURLWithPath: inputPath)

guard FileManager.default.fileExists(atPath: inputPath) else { emptyResult(); exit(0) }

let ext = url.pathExtension.lowercased()
if ext == "pdf" {
    processPDF(url: url)
} else {
    processImage(url: url)
}
