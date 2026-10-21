//  ScreenTour.swift — a scratch screenshot tour, copied from
//  .claude/skills/ios-validate/screen-tour.swift. Gitignored, so it never
//  ships. Run it with `scripts/ios-validate.sh tour ScreenTour`.

import XCTest

final class ScreenTour: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    func testTour() throws {
        continueAfterFailure = true
        try launchSignedIn()

        // One block per screen: open it, wait for what proves it drew, shoot.
        open("you")
        XCTAssertTrue(app.staticTexts["User settings"].waitForExistence(timeout: 10))
        shot("01-you")

        open("library/shelves")
        XCTAssertTrue(app.staticTexts["Shelves"].firstMatch.waitForExistence(timeout: 10))
        shot("02-shelves")
    }

    // MARK: - Helpers

    /// A clean launch (`--uitest-reset` clears the server, session and saved
    /// preferences), then connect to the scratch server and sign in.
    private func launchSignedIn() throws {
        // A plain `just ios-test-ui` builds this file too; only a tour run passes the server.
        guard let server = env["OMNIBUS_TOUR_SERVER"] else {
            throw XCTSkip("a tour runs through scripts/ios-validate.sh tour")
        }
        app = XCUIApplication()
        app.launchArguments += ["--uitest-reset"]
        app.launch()
        let address = app.textFields["server-address"]
        XCTAssertTrue(address.waitForExistence(timeout: 30))
        address.tap()
        address.typeText(server)
        app.buttons["Connect"].tap()
        let user = app.textFields["Username"]
        XCTAssertTrue(user.waitForExistence(timeout: 30))
        user.tap()
        user.typeText(env["OMNIBUS_TOUR_USER"] ?? "")
        let password = app.secureTextFields["Password"]
        password.tap()
        password.typeText(env["OMNIBUS_TOUR_PASSWORD"] ?? "")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.buttons["Library"].waitForExistence(timeout: 30))
        dismissSavePassword()
    }

    /// Opens `omnibus://debug/screen/<route>`: a tab, then the screens to push
    /// (`App/DebugScreenLink.swift` lists the words).
    private func open(_ route: String) {
        XCUIDevice.shared.system.open(URL(string: "omnibus://debug/screen/\(route)")!)
        // iOS asks before handing an app a URL opened from outside it.
        let confirm = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if confirm.waitForExistence(timeout: 3) { confirm.tap() }
        dismissSavePassword()
    }

    private func shot(_ name: String) {
        sleep(1) // transitions and cover loads settle
        let dir = URL(fileURLWithPath: env["OMNIBUS_TOUR_SHOTS"] ?? NSTemporaryDirectory())
        let png = XCUIScreen.main.screenshot().pngRepresentation
        XCTAssertNoThrow(try png.write(to: dir.appendingPathComponent("\(name).png")))
    }

    /// The keychain's "Save Password?" prompt lands after sign-in, sometimes a screen later.
    private func dismissSavePassword() {
        for target in [app!, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
            let notNow = target.buttons["Not Now"]
            if notNow.waitForExistence(timeout: 1) { notNow.tap() }
        }
    }

    /// Swipes until `element` is on screen: a lazy grid only builds the cells near it.
    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 8) {
        var swipes = 0
        while !(element.exists && element.isHittable) && swipes < maxSwipes {
            app.swipeUp(velocity: .slow)
            swipes += 1
        }
    }
}
