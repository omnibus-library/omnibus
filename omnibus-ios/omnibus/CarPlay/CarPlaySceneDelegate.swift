//  CarPlaySceneDelegate.swift
//  The CarPlay scene: hands the car's interface to `CarPlayController` while it's connected.
//
//  Declared in Info.plist's scene manifest under the CarPlay role. The car can
//  launch the process with only this scene connected — no phone window, no
//  `AppState` — which is why everything it reads goes through `Startup` and
//  the singletons rather than the SwiftUI environment.

#if canImport(CarPlay)
import CarPlay

@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var controller: CarPlayController?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        let controller = CarPlayController(interface: interfaceController)
        self.controller = controller
        controller.start()
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        controller?.stop()
        controller = nil
    }
}
#endif
