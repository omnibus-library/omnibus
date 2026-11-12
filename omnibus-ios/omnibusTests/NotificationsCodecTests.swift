//  NotificationsCodecTests.swift
//  The notifications wire contract with `omnibus_shared::notifications` and
//  `PublicUrl*`: what the app decodes, what it sends — above all which secret
//  keys an edit leaves out — and the route each service call takes.

import Foundation
import Testing

@testable import omnibus

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

private func encodedObject(_ value: some Encodable) throws -> [String: Any] {
    let data = try JSONEncoder().encode(value)
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

/// The `settings` object of an encoded input or test request.
private func encodedSettings(_ value: some Encodable) throws -> [String: Any] {
    try #require(try encodedObject(value)["settings"] as? [String: Any])
}

let connectionsJSON = """
    {"connections":[
     {"id":1,"name":"Ada\u{2019}s phone","enabled":true,"events":["request_needs_chooser"],
      "settings":{"kind":"ntfy","server_url":"https://ntfy.sh","topic":"books","auth":"token",
       "username":null,"token_set":true,"password_set":false,"priority":4,"tags":["books","bell"],
       "include_details":true},
      "last_delivery":{"at":1790000000,"ok":true,"error":null}},
     {"id":2,"name":"Den","enabled":false,"events":[],
      "settings":{"kind":"ntfy","server_url":"https://example.com/ntfy","topic":"den","auth":"basic",
       "username":"sam","token_set":false,"password_set":true,"priority":3,"tags":[],
       "include_details":false},
      "last_delivery":{"at":1790000100,"ok":false,"error":"the server answered 401 Unauthorized: {\\"code\\":40101}"}},
     {"id":3,"name":"Fresh","enabled":true,"events":["request_needs_chooser"],
      "settings":{"kind":"ntfy","server_url":"http://10.0.0.2:8080","topic":"t","auth":"none",
       "username":null,"token_set":false,"password_set":false,"priority":1,"tags":[],
       "include_details":true},
      "last_delivery":null},
     {"id":4,"name":"Later","enabled":true,"events":["something_new"],
      "settings":{"kind":"gotify","app_token_set":true},
      "last_delivery":null}
    ],"available_events":["request_needs_chooser"]}
    """

/// The decoded fixture, for tests that start from a saved connection.
func savedConnections() throws -> [NotificationConnection] {
    try JSONDecoder().decode(NotificationConnections.self, from: Data(connectionsJSON.utf8)).connections
}

@Suite("Notifications wire contract")
struct NotificationsCodecTests {
    // MARK: - Decoding

    @Test("the connections list decodes a delivered, a failed and a never-sent connection")
    func decodesEveryDeliveryShape() throws {
        let list = try decode(NotificationConnections.self, connectionsJSON)
        #expect(list.connections.map(\.id) == [1, 2, 3, 4])
        #expect(list.availableEvents == [.requestNeedsChooser])

        let delivered = list.connections[0]
        #expect(delivered.name == "Ada\u{2019}s phone")
        #expect(delivered.enabled)
        #expect(delivered.events == [.requestNeedsChooser])
        #expect(delivered.lastDelivery == NotificationLastDelivery(at: 1_790_000_000, ok: true, error: nil))
        guard case let .ntfy(settings) = delivered.settings else {
            Issue.record("expected ntfy settings")
            return
        }
        #expect(settings == NtfySettingsStatus(
            serverURL: "https://ntfy.sh", topic: "books", auth: .token, username: nil,
            tokenSet: true, passwordSet: false, priority: 4, tags: ["books", "bell"], includeDetails: true
        ))

        let failed = list.connections[1]
        #expect(!failed.enabled)
        #expect(failed.lastDelivery?.ok == false)
        #expect(failed.lastDelivery?.error == "the server answered 401 Unauthorized: {\"code\":40101}")
        if case let .ntfy(basic) = failed.settings {
            #expect(basic.auth == .basic)
            #expect(basic.username == "sam")
            #expect(basic.passwordSet)
            #expect(!basic.includeDetails)
        } else {
            Issue.record("expected ntfy settings")
        }

        #expect(list.connections[2].lastDelivery == nil)
    }

    @Test("a provider this build doesn't know decodes as unknown instead of failing the list")
    func unknownKindDoesNotThrow() throws {
        let later = try decode(NotificationConnections.self, connectionsJSON).connections[3]
        #expect(later.settings == .unknown(kind: "gotify"))
        #expect(later.settings.kind == "gotify")
        // An event this build doesn't know survives as its own name.
        #expect(later.events == [NotificationEventName(rawValue: "something_new")])
    }

    @Test("a server without book requests offers no events")
    func decodesNoAvailableEvents() throws {
        let list = try decode(NotificationConnections.self, #"{"connections":[],"available_events":[]}"#)
        #expect(list.connections.isEmpty)
        #expect(list.availableEvents.isEmpty)
    }

    @Test("the public URL status decodes each source")
    func decodesPublicURLSources() throws {
        #expect(
            try decode(PublicURLStatus.self, #"{"url":"https://books.example.com","source":"settings"}"#)
                == PublicURLStatus(url: "https://books.example.com", source: .settings)
        )
        #expect(
            try decode(PublicURLStatus.self, #"{"url":"https://env.example.com","source":"env"}"#)
                == PublicURLStatus(url: "https://env.example.com", source: .env)
        )
        #expect(
            try decode(PublicURLStatus.self, #"{"url":null,"source":"none"}"#)
                == PublicURLStatus(url: nil, source: .none)
        )
        #expect(PublicURLSource.allCases == [.settings, .env, .none])
    }

    // MARK: - Encoding

    @Test("a cleared public URL is sent as an explicit null")
    func publicURLClearIsNull() throws {
        let cleared = try encodedObject(PublicURLUpdate(url: nil))
        #expect(cleared.keys.contains("url"))
        #expect(cleared["url"] is NSNull)
        #expect(try encodedObject(PublicURLUpdate(url: "https://b.example"))["url"] as? String == "https://b.example")
    }

    @Test("a new token connection sends every field and its token, and no password")
    func encodesCreateWithToken() throws {
        var draft = NtfyDraft(offering: [.requestNeedsChooser])
        draft.name = "  Ada\u{2019}s phone "
        draft.serverURL = " https://ntfy.sh "
        draft.topic = "books"
        draft.auth = .token
        draft.token = " tk_secret "
        draft.priority = 5
        draft.tags = "books, bell"
        draft.includeDetails = false

        let object = try encodedObject(draft.input)
        #expect(object["name"] as? String == "Ada\u{2019}s phone")
        #expect(object["enabled"] as? Bool == true)
        #expect(object["events"] as? [String] == ["request_needs_chooser"])

        let settings = try encodedSettings(draft.input)
        #expect(settings["kind"] as? String == "ntfy")
        #expect(settings["server_url"] as? String == "https://ntfy.sh")
        #expect(settings["topic"] as? String == "books")
        #expect(settings["auth"] as? String == "token")
        #expect(settings["token"] as? String == "tk_secret")
        #expect(settings["priority"] as? Int == 5)
        #expect(settings["tags"] as? [String] == ["books", "bell"])
        #expect(settings["include_details"] as? Bool == false)
        #expect(!settings.keys.contains("password"))
        #expect(!settings.keys.contains("username"))
    }

    @Test("an edit that leaves the token blank sends no token or password key at all")
    func editKeepingSecretOmitsTheKeys() throws {
        let saved = try savedConnections()[0]
        var draft = try #require(NtfyDraft(editing: saved))
        draft.name = "Renamed"

        let settings = try encodedSettings(draft.input)
        #expect(!settings.keys.contains("token"))
        #expect(!settings.keys.contains("password"))
        #expect(settings["auth"] as? String == "token")
        #expect(try encodedObject(draft.input)["name"] as? String == "Renamed")
    }

    @Test("an edit that leaves the password blank sends the username and no password key")
    func editKeepingPasswordOmitsTheKey() throws {
        let draft = try #require(NtfyDraft(editing: try savedConnections()[1]))
        let settings = try encodedSettings(draft.input)
        #expect(settings["username"] as? String == "sam")
        #expect(!settings.keys.contains("password"))
        #expect(!settings.keys.contains("token"))
    }

    @Test("an edit that types a new token sends it")
    func editReplacingSendsTheNewSecret() throws {
        var draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        draft.token = "tk_new"
        #expect(try encodedSettings(draft.input)["token"] as? String == "tk_new")
    }

    @Test("switching a token connection to basic sends the username and password, never the token")
    func authSwitchToBasic() throws {
        var draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        draft.auth = .basic
        draft.username = " ada "
        draft.password = "pa ss"
        let settings = try encodedSettings(draft.input)
        #expect(settings["auth"] as? String == "basic")
        #expect(settings["username"] as? String == "ada")
        // A password is sent as typed: spaces inside it are part of it.
        #expect(settings["password"] as? String == "pa ss")
        #expect(!settings.keys.contains("token"))
    }

    @Test("switching to no sign-in sends neither secret nor a username, even one still typed")
    func authSwitchToNone() throws {
        var draft = try #require(NtfyDraft(editing: try savedConnections()[1]))
        draft.password = "typed then abandoned"
        draft.auth = .none
        let settings = try encodedSettings(draft.input)
        #expect(settings["auth"] as? String == "none")
        #expect(!settings.keys.contains("token"))
        #expect(!settings.keys.contains("password"))
        #expect(!settings.keys.contains("username"))
    }

    @Test("turning a connection off sends it as saved with no secret")
    func enabledTogglePayload() throws {
        let saved = try savedConnections()[0]
        let input = try #require(NtfyDraft.toggled(saved, enabled: false))
        let object = try encodedObject(input)
        #expect(object["enabled"] as? Bool == false)
        #expect(object["name"] as? String == saved.name)
        #expect(object["events"] as? [String] == ["request_needs_chooser"])

        let settings = try encodedSettings(input)
        #expect(settings["server_url"] as? String == "https://ntfy.sh")
        #expect(settings["topic"] as? String == "books")
        #expect(settings["auth"] as? String == "token")
        #expect(settings["priority"] as? Int == 4)
        #expect(settings["tags"] as? [String] == ["books", "bell"])
        #expect(!settings.keys.contains("token"))
        #expect(!settings.keys.contains("password"))
    }

    @Test("a provider this build doesn't know has no toggle payload")
    func unknownKindCannotBeToggled() throws {
        #expect(NtfyDraft.toggled(try savedConnections()[3], enabled: false) == nil)
    }

    @Test("a test of a saved connection names it, so a blank secret falls back to the saved one")
    func testRequestCarriesTheID() throws {
        let draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        let object = try encodedObject(draft.testRequest)
        #expect(object["id"] as? Int == 1)
        let settings = try encodedSettings(draft.testRequest)
        #expect(settings["kind"] as? String == "ntfy")
        #expect(!settings.keys.contains("token"))
    }

    @Test("a test of an unsaved connection sends no id")
    func testRequestWithoutID() throws {
        var draft = NtfyDraft(offering: [])
        draft.serverURL = "https://ntfy.sh"
        draft.topic = "t"
        let object = try encodedObject(draft.testRequest)
        #expect(!object.keys.contains("id"))
        #expect((object["settings"] as? [String: Any])?["topic"] as? String == "t")
    }

    // MARK: - Routes and errors

    @Test("each call is the exact verb and path the server mounts")
    func routes() {
        typealias R = NotificationService.Routes
        #expect(R.readPublicURL == NotificationRoute(method: "GET", path: "/api/settings/public-url"))
        #expect(R.savePublicURL == NotificationRoute(method: "POST", path: "/api/settings/public-url"))
        #expect(R.list == NotificationRoute(method: "GET", path: "/api/admin/notifications/connections"))
        #expect(R.create == NotificationRoute(method: "POST", path: "/api/admin/notifications/connections"))
        #expect(R.update(id: 7) == NotificationRoute(method: "PUT", path: "/api/admin/notifications/connections/7"))
        #expect(R.delete(id: 7) == NotificationRoute(method: "DELETE", path: "/api/admin/notifications/connections/7"))
        #expect(R.test == NotificationRoute(method: "POST", path: "/api/admin/notifications/test"))
    }

    @Test("a refused value and a provider's answer are shown in the server's own words")
    func errorTextIsTheServers() {
        #expect(
            NotificationsFlow.message(APIError.http(status: 422, message: "public url must start with http:// or https://"))
                == "public url must start with http:// or https://"
        )
        #expect(
            NotificationsFlow.message(APIError.http(status: 502, message: "the server answered 401 Unauthorized"))
                == "the server answered 401 Unauthorized"
        )
        #expect(NotificationsFlow.message(APIError.http(status: 404, message: "no such notification connection"))
            .hasPrefix("That connection is gone"))
        #expect(NotificationsFlow.message(APIError.offline) == "You're offline.")
        #expect(NotificationsFlow.message(FakeFailure()) == "boom")
    }
}
