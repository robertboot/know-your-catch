import UIKit
import Capacitor

/// Bridge view controller that explicitly registers app-target plugins.
///
/// Capacitor auto-discovers plugins that ship inside Swift packages, but a
/// plugin defined in the app target itself is not picked up that way — the
/// app reported '"SubjectDetector" plugin is not implemented on ios' even
/// after the Swift file was compiling. `capacitorDidLoad()` is the
/// documented hook for registering those by hand, and being explicit here
/// means the registration can't silently regress again.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SubjectDetectorPlugin())
    }
}
