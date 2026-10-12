// Draws the 1024px app icon: a microphone (speaking your answer) joined to diagram nodes (drawing the system).
// Usage: swift make_icon.swift out.png
import AppKit

let N: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(N), pixelsHigh: Int(N), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let g = ctx.cgContext

func rgb(_ hex: Int, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}
let amber = rgb(0xF5B041), amberDeep = rgb(0xE08A12), white = rgb(0xFFFFFF), ink0 = rgb(0x3B4BA8), ink1 = rgb(0x0E1233)

// Body: macOS icon grid is an 824pt squircle inside the 1024pt canvas, with a soft shadow.
let body = NSRect(x: 100, y: 100, width: 824, height: 824)
let path = NSBezierPath(roundedRect: body, xRadius: 186, yRadius: 186)
g.saveGState()
g.setShadow(offset: CGSize(width: 0, height: -14), blur: 30, color: rgb(0x000000, 0.35).cgColor)
rgb(0x000000).setFill(); path.fill()
g.restoreGState()
g.saveGState()
path.addClip()
NSGradient(colors: [ink0, ink1], atLocations: [0, 1], colorSpace: .sRGB)!.draw(in: body, angle: -70)
// soft light from the top left
NSGradient(colors: [rgb(0xFFFFFF, 0.20), rgb(0xFFFFFF, 0)], atLocations: [0, 0.6], colorSpace: .sRGB)!
    .draw(in: body, angle: -90)
g.restoreGState()
rgb(0xFFFFFF, 0.14).setStroke(); path.lineWidth = 3; path.stroke()

// Everything below is shifted down so the group sits optically centred.
g.translateBy(x: 0, y: -48)

// Diagram: two nodes joined to the microphone by lines.
let nodes = [CGPoint(x: 258, y: 700), CGPoint(x: 766, y: 700)]
g.saveGState()
g.setLineWidth(22); g.setLineCap(.round); g.setStrokeColor(rgb(0xFFFFFF, 0.30).cgColor)
for n in nodes { g.move(to: n); g.addLine(to: CGPoint(x: 512, y: 640)) }
g.strokePath()
g.restoreGState()
for n in nodes {
    g.saveGState()
    g.setShadow(offset: CGSize(width: 0, height: -6), blur: 14, color: rgb(0x000000, 0.35).cgColor)
    let r = NSRect(x: n.x - 56, y: n.y - 56, width: 112, height: 112)
    let c = NSBezierPath(ovalIn: r); c.addClip()
    NSGradient(colors: [amber, amberDeep], atLocations: [0, 1], colorSpace: .sRGB)!.draw(in: r, angle: -90)
    g.restoreGState()
}

// Microphone capsule.
g.saveGState()
g.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: rgb(0x000000, 0.4).cgColor)
let cap = NSRect(x: 512 - 92, y: 470, width: 184, height: 330)
let capPath = NSBezierPath(roundedRect: cap, xRadius: 92, yRadius: 92)
rgb(0x000000).setFill(); capPath.fill()
g.restoreGState()
g.saveGState()
capPath.addClip()
NSGradient(colors: [rgb(0xFFFFFF), rgb(0xD5DBF0)], atLocations: [0, 1], colorSpace: .sRGB)!.draw(in: cap, angle: -90)
// grille lines
g.setStrokeColor(rgb(0x3B4BA8, 0.28).cgColor); g.setLineWidth(8); g.setLineCap(.round)
for y in stride(from: CGFloat(540), through: 740, by: 50) { g.move(to: CGPoint(x: 452, y: y)); g.addLine(to: CGPoint(x: 572, y: y)) }
g.strokePath()
g.restoreGState()

// Holder (U), stem and base in amber.
g.saveGState()
g.setShadow(offset: CGSize(width: 0, height: -6), blur: 14, color: rgb(0x000000, 0.35).cgColor)
g.setStrokeColor(amber.cgColor); g.setLineWidth(40); g.setLineCap(.round)
g.addArc(center: CGPoint(x: 512, y: 560), radius: 150, startAngle: .pi, endAngle: 0, clockwise: false)
g.move(to: CGPoint(x: 512, y: 410)); g.addLine(to: CGPoint(x: 512, y: 330))
g.move(to: CGPoint(x: 420, y: 330)); g.addLine(to: CGPoint(x: 604, y: 330))
g.strokePath()
g.restoreGState()

NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
