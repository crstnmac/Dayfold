// Draws the Dayfold app icon as a 1024px PNG: a sun rising out of an open fold (a day, folded).
// Colours are the product tokens from src/renderer/src/assets/main.css converted from oklch:
// warm ink (--primary) for the tile, warm paper (--card, --muted) for the fold, and the single
// volt accent (--chart-1, dark-mode value) for the sun.
// Usage: swiftc -O scripts/make-app-icon.swift -o /tmp/make-app-icon && /tmp/make-app-icon out.png
import AppKit

let size: CGFloat = 1024
let args = CommandLine.arguments
guard args.count == 2 || args.count == 5 else {
  FileHandle.standardError.write(Data("usage: make-app-icon out.png [r g b]\n".utf8))
  exit(2)
}
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
guard
  let ctx = CGContext(
    data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0,
    space: srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { exit(1) }

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: r, green: g, blue: b, alpha: a)
}
let inkHi = rgb(0.19, 0.177, 0.163), inkLo = rgb(0.085, 0.076, 0.066)
let card = rgb(0.996, 0.993, 0.988), muted = rgb(0.935, 0.927, 0.911)
let shade = rgb(0.804, 0.792, 0.772), shade2 = rgb(0.866, 0.856, 0.838)
// The accent (the sun); pass r g b (0-1) to try another.
let accent: CGColor =
  args.count == 5 ? rgb(CGFloat(Double(args[2])!), CGFloat(Double(args[3])!), CGFloat(Double(args[4])!)) : rgb(0.798, 0.926, 0.256)
let cx = size / 2

// macOS icon grid: artwork occupies ~824px of the 1024 canvas, with a soft shadow.
let rect = CGRect(x: 100, y: 100, width: 824, height: 824)
let body = CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 28, color: rgb(0, 0, 0, 0.28))
ctx.addPath(body)
ctx.setFillColor(inkLo)
ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(body)
ctx.clip()
let tile = CGGradient(colorsSpace: srgb, colors: [inkHi, inkLo] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(
  tile, start: CGPoint(x: cx, y: rect.maxY), end: CGPoint(x: cx, y: rect.minY), options: [])
ctx.restoreGState()

func panel(_ pts: [(CGFloat, CGFloat)], _ top: CGColor, _ bottom: CGColor) {
  let p = CGMutablePath()
  p.move(to: CGPoint(x: pts[0].0, y: pts[0].1))
  for q in pts.dropFirst() { p.addLine(to: CGPoint(x: q.0, y: q.1)) }
  p.closeSubpath()
  ctx.saveGState()
  ctx.addPath(p)
  ctx.clip()
  let g = CGGradient(colorsSpace: srgb, colors: [top, bottom] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(
    g, start: CGPoint(x: cx, y: pts.map { $0.1 }.max()!),
    end: CGPoint(x: cx, y: pts.map { $0.1 }.min()!), options: [])
  ctx.restoreGState()
}

// The sun, behind the fold.
let sun = CGPoint(x: cx, y: 520)
ctx.setStrokeColor(accent)
ctx.setLineWidth(26)
ctx.setLineCap(.round)
for i in 0..<7 {
  let a = (15.0 + 150.0 * Double(i) / 6.0) * .pi / 180
  ctx.move(to: CGPoint(x: sun.x + cos(a) * 235, y: sun.y + sin(a) * 235))
  ctx.addLine(to: CGPoint(x: sun.x + cos(a) * 300, y: sun.y + sin(a) * 300))
  ctx.strokePath()
}
ctx.setFillColor(accent)
ctx.fillEllipse(in: CGRect(x: sun.x - 190, y: sun.y - 190, width: 380, height: 380))

// The fold: two panels meeting at the crease; the right one leans away and sits in shade.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 22, color: rgb(0, 0, 0, 0.5))
panel([(190, 470), (cx, 395), (cx, 175), (190, 250)], card, muted)
panel([(cx, 395), (834, 470), (834, 250), (cx, 175)], shade, shade2)
ctx.restoreGState()

guard let image = ctx.makeImage() else { exit(1) }
let rep = NSBitmapImageRep(cgImage: image)
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: args[1]))
