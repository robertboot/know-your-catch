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
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

        do {
            try handler.perform([objectness, attention])
        } catch {
            call.reject("vision failed: \(error.localizedDescription)")
            return
        }

        let box = Self.bestBox(from: objectness) ?? Self.bestBox(from: attention)

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
