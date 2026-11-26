import Foundation
import Capacitor
import Vision
import UIKit

/// Finds the main subject in a photo so the classifier can be handed the
/// fish instead of the whole boat scene.
///
/// Why this exists: DeepBlue is accurate when the fish fills the frame and
/// unreliable when it doesn't — an uncropped grouper came back "Cubera
/// Snapper" at 0.75 confidence, while the same photo cropped to the fish
/// gave the correct species at 0.85. Cropping by hand fixed it every time,
/// so the app should do that crop itself. This is the same idea as Google
/// Lens drawing a box around the subject before searching.
///
/// Vision's saliency requests run on-device in a few milliseconds and need
/// no network, which keeps the offline-first guarantee intact.
///
/// Returns a normalised rect in TOP-LEFT origin coordinates (0..1), because
/// that is what canvas/CSS on the JS side expect. Vision reports
/// bottom-left origin, so y is flipped here rather than at the call site.
@objc(SubjectDetectorPlugin)
public class SubjectDetectorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SubjectDetectorPlugin"
    public let jsName = "SubjectDetector"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "detect", returnType: CAPPluginReturnPromise)
    ]

    @objc func detect(_ call: CAPPluginCall) {
        guard let dataUrl = call.getString("image") else {
            call.reject("missing image")
            return
        }

        // Accept either a bare base64 string or a full data: URL.
        let base64 = dataUrl.contains(",")
            ? String(dataUrl[dataUrl.index(after: dataUrl.firstIndex(of: ",")!)...])
            : dataUrl

        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cgImage = image.cgImage else {
            call.reject("could not decode image")
            return
        }

        // Objectness saliency highlights discrete objects; attention
        // saliency highlights what a person would look at first. For a
        // held-up fish the objectness pass is the better fit, but it can
        // come back empty on low-contrast scenes, so attention is kept as
        // a second try before giving up.
        let objectness = VNGenerateObjectnessBasedSaliencyImageRequest()
        let attention  = VNGenerateAttentionBasedSaliencyImageRequest()
        // Orientation MUST be passed. A .cgImage is the raw sensor buffer;
        // iPhone portrait shots are stored landscape with a rotation flag,
        // and the JS side draws through <img>, which applies that flag.
        // Analysing the unrotated buffer returns a box in a different
        // coordinate space than the crop it feeds, so the crop lands in
        // the wrong place — or spans the frame and gets discarded.
        let handler = VNImageRequestHandler(cgImage: cgImage,
                                            orientation: Self.cgOrientation(image.imageOrientation),
                                            options: [:])

        do {
            try handler.perform([objectness, attention])
        } catch {
            call.reject("vision failed: \(error.localizedDescription)")
            return
        }

        // Preference order:
        //   1. Foreground instance mask (iOS 17+) — the same segmentation
        //      behind "lift subject from background". It returns the
        //      subject's actual silhouette, so the bounding box hugs the
        //      fish instead of the scene.
        //   2. Saliency, which in practice kept returning ~the whole
        //      frame on boat photos (measured 0.92x0.99) and so produced
        //      no useful crop.
        var box: CGRect? = nil
        if #available(iOS 17.0, *) {
            box = Self.foregroundBox(cgImage: cgImage,
                                     orientation: Self.cgOrientation(image.imageOrientation))
        }
        if box == nil { box = Self.bestBox(from: objectness) ?? Self.bestBox(from: attention) }

        guard let rect = box else {
            // No subject found is a legitimate outcome, not an error — the
            // caller falls back to classifying the full frame.
            call.resolve(["found": false])
            return
        }

        call.resolve([
            "found": true,
            "x": rect.origin.x,
            // Vision uses a bottom-left origin; flip to top-left for JS.
            "y": 1.0 - rect.origin.y - rect.size.height,
            "w": rect.size.width,
            "h": rect.size.height
        ])
    }

    /// Bounding box of the foreground subject via instance segmentation.
    ///
    /// Saliency answers "what stands out", which on a photo of two people
    /// holding a fish on a boat is essentially everything. Segmentation
    /// answers "what is the subject", returning a per-pixel mask we can
    /// tighten a box around — much closer to what Google Lens draws.
    @available(iOS 17.0, *)
    private static func foregroundBox(cgImage: CGImage,
                                      orientation: CGImagePropertyOrientation) -> CGRect? {
        let req = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        do { try handler.perform([req]) } catch { return nil }
        guard let obs = req.results?.first, !obs.allInstances.isEmpty else { return nil }

        guard let mask = try? obs.generateScaledMaskForImage(forInstances: obs.allInstances,
                                                             from: handler) else { return nil }
        CVPixelBufferLockBaseAddress(mask, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }

        let w = CVPixelBufferGetWidth(mask)
        let h = CVPixelBufferGetHeight(mask)
        guard w > 0, h > 0,
              let base = CVPixelBufferGetBaseAddress(mask) else { return nil }
        let stride = CVPixelBufferGetBytesPerRow(mask)
        let ptr = base.assumingMemoryBound(to: UInt8.self)

        // Tighten to the mask's extent. Step a few pixels at a time — this
        // is a coarse box, not a matte, and scanning every pixel of a large
        // buffer on the main path isn't worth the accuracy.
        let step = max(1, min(w, h) / 256)
        var minX = w, minY = h, maxX = -1, maxY = -1
        for y in Swift.stride(from: 0, to: h, by: step) {
            let row = ptr + y * stride
            for x in Swift.stride(from: 0, to: w, by: step) {
                if row[x] > 128 {
                    if x < minX { minX = x }
                    if x > maxX { maxX = x }
                    if y < minY { minY = y }
                    if y > maxY { maxY = y }
                }
            }
        }
        guard maxX >= minX, maxY >= minY else { return nil }

        let rect = CGRect(x: CGFloat(minX) / CGFloat(w),
                          // Mask rows run top-down; callers expect the same
                          // bottom-left convention Vision uses elsewhere,
                          // and detect() flips it once for JS.
                          y: 1.0 - CGFloat(maxY) / CGFloat(h),
                          width:  CGFloat(maxX - minX) / CGFloat(w),
                          height: CGFloat(maxY - minY) / CGFloat(h))
        if rect.width > 0.97 && rect.height > 0.97 { return nil }
        if rect.width < 0.05 || rect.height < 0.05 { return nil }
        return rect
    }

    /// UIImage.Orientation → CGImagePropertyOrientation. Vision takes the
    /// latter; UIKit reports the former, and they are not the same enum.
    private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up:            return .up
        case .down:          return .down
        case .left:          return .left
        case .right:         return .right
        case .upMirrored:    return .upMirrored
        case .downMirrored:  return .downMirrored
        case .leftMirrored:  return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default:    return .up
        }
    }

    /// Pick the STRONGEST single salient object, not the union of all of
    /// them.
    ///
    /// Union was the first attempt and it fails on exactly the photos this
    /// exists for: two anglers, rods, a cooler and a fish produce several
    /// blobs, and their union spans essentially the whole frame — which
    /// then gets rejected as useless, so no crop happens at all. A held-up
    /// fish is reliably the highest-confidence object, so take that one.
    ///
    /// Boxes are only merged when they overlap substantially, which covers
    /// a long fish that saliency splits into head and tail halves without
    /// re-introducing the everything-union problem.
    private static func bestBox(from request: VNRequest) -> CGRect? {
        guard let obs = request.results?.first as? VNSaliencyImageObservation,
              let objects = obs.salientObjects,
              !objects.isEmpty else { return nil }

        let sorted = objects.sorted { $0.confidence > $1.confidence }
        var box = sorted[0].boundingBox

        for other in sorted.dropFirst() {
            let inter = box.intersection(other.boundingBox)
            if inter.isNull { continue }
            let smaller = min(box.width * box.height,
                              other.boundingBox.width * other.boundingBox.height)
            guard smaller > 0 else { continue }
            // Merge only when the overlap is a large share of the smaller
            // box — i.e. they're plainly parts of one subject.
            if (inter.width * inter.height) / smaller > 0.35 {
                box = box.union(other.boundingBox)
            }
        }

        // A box covering nearly the whole frame tells us nothing, and
        // cropping to it would be a no-op.
        if box.width > 0.95 && box.height > 0.95 { return nil }
        return box
    }
}
