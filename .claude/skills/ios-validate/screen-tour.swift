//  ScreenTour.swift — a scratch screenshot tour, copied from
//  .claude/skills/ios-validate/screen-tour.swift. Gitignored, so it never
//  ships. Run it with `scripts/ios-validate.sh tour ScreenTour` (add `--duo`
//  for the iPhone Duo).

import XCTest

final class ScreenTour: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment
    private var poseNumber = 0

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

        // Poses: `rotate <portrait|landscape-left|landscape-right|portrait-upside-down>`
        // on any iPhone; `open`, `close`, `half`, `hinge <deg>` on the Duo only.
        pose("rotate landscape-left")
        shot("03-shelves-landscape")
        pose("rotate portrait")
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

    /// Shot by the host, of whichever display hosts the UI: an open Duo's
    /// `XCUIScreen.main` is its dark cover.
    private func shot(_ name: String) {
        sleep(1) // transitions and cover loads settle
        pose("screenshot \(name)")
    }

    /// Asks `scripts/ios-validate.sh` to run `scripts/ios-pose.sh <request>` on
    /// this simulator and waits for the answer; a failed pose fails the test.
    private func pose(_ request: String, timeout: TimeInterval? = nil) {
        guard let path = env["OMNIBUS_TOUR_POSE"] else {
            return XCTFail("pose(\(request)) needs scripts/ios-validate.sh tour")
        }
        // A hinge waits up to 2 × OMNIBUS_IOS_POSE_TIMEOUT + 8 s, plus the helper's first build.
        let step = Double(Int(env["OMNIBUS_IOS_POSE_TIMEOUT"] ?? "") ?? 8)
        let timeout = timeout ?? max(60, 2 * step + 40)
        // Numbered, so a late reply to a request that timed out is never taken as this one's.
        poseNumber += 1
        let number = "\(poseNumber)"
        let files = FileManager.default
        let dir = URL(fileURLWithPath: path)
        let reply = dir.appendingPathComponent("reply")
        let claimed = dir.appendingPathComponent("reply.claimed")
        let posted = dir.appendingPathComponent("request")
        try? files.removeItem(at: reply)
        let pending = dir.appendingPathComponent("request.tmp")
        XCTAssertNoThrow(try Data("\(number) \(request)".utf8).write(to: pending))
        try? files.removeItem(at: posted) // one that timed out, still unread
        XCTAssertNoThrow(try files.moveItem(at: pending, to: posted))
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            // Claimed before it is read, so a reply landing after the read is never deleted unread.
            try? files.removeItem(at: claimed)
            if (try? files.moveItem(at: reply, to: claimed)) != nil,
               let answer = try? String(contentsOf: claimed, encoding: .utf8) {
                try? files.removeItem(at: claimed)
                let parts = answer.trimmingCharacters(in: .whitespacesAndNewlines)
                    .split(separator: " ", maxSplits: 1).map(String.init)
                guard parts.first == number else { continue }
                let body = parts.count > 1 ? parts[1] : ""
                XCTAssertTrue(body.hasPrefix("ok"), "pose(\(request)): \(body)")
                let verb = request.split(separator: " ").first.map(String.init) ?? ""
                if ["rotate", "open", "close", "half", "hinge"].contains(verb) {
                    sleep(1) // the app relays out after a fold or turn
                }
                return
            }
            usleep(200_000)
        }
        XCTFail("pose(\(request)) got no answer in \(Int(timeout))s")
    }

    /// The keychain's "Save Password?" prompt lands after sign-in, sometimes a screen later.
    private func dismissSavePassword() {
        for target in [app!, XCUIApplication(bundleIdentifier: "com.apple.springboard")] {
            let notNow = target.buttons["Not Now"]
            if notNow.waitForExistence(timeout: 1) { notNow.tap() }
        }
    }

    /// Swipes until `element` is on screen: a lazy grid only builds the cells near it.
    /// Swipes the outermost scroller, not the app: an open Duo's app frame is its cover.
    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 8) {
        // Document order puts the page's scroller before any strip nested inside it.
        let types = [XCUIElement.ElementType.scrollView.rawValue, XCUIElement.ElementType.collectionView.rawValue]
        let scroller = app.descendants(matching: .any)
            .matching(NSPredicate(format: "elementType IN %@", types)).firstMatch
        let surface: XCUIElement = scroller.exists ? scroller : app
        var swipes = 0
        while !(element.exists && element.isHittable) && swipes < maxSwipes {
            surface.swipeUp(velocity: .slow)
            swipes += 1
        }
    }
}
