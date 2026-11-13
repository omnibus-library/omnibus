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

/// The server's sentence for an ntfy 401, exactly as the contract writes it.
let unauthorizedSentence = "ntfy refused the sign-in. Check the access token, or the username and password."
/// The server's sentence for a connection it couldn't reach.
let refusedConnectionSentence =
    "Couldn't connect to the ntfy server. Check the server URL and that the server is running."

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
      "last_delivery":{"at":1790000100,"ok":false,"error":"\(unauthorizedSentence)"}},
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
        #expect(failed.lastDelivery?.error == unauthorizedSentence)
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
    }

    @Test("a public URL source this build doesn't know decodes and claims no source")
    func unknownSourceDoesNotThrow() throws {
        let status = try decode(PublicURLStatus.self, #"{"url":"https://b.example","source":"cluster"}"#)
        #expect(status.source == .unknown("cluster"))
        #expect(status.url == "https://b.example")
        #expect(NotificationsFlow.sourceLine(status) == "Set.")
        #expect(NotificationsModel.fieldText(status).isEmpty)
        #expect(NotificationsFlow.sourceLine(PublicURLStatus(url: nil, source: .unknown("cluster"))) == "Not set.")
    }

    @Test("a sign-in mode this build doesn't know decodes, and its connection is read-only")
    func unknownAuthDoesNotThrow() throws {
        let json = """
            {"connections":[{"id":9,"name":"Hub","enabled":true,"events":[],
              "settings":{"kind":"ntfy","server_url":"https://ntfy.sh","topic":"hub","auth":"oauth",
               "username":null,"token_set":false,"password_set":false,"priority":3,"tags":[],
               "include_details":true},
              "last_delivery":null}],"available_events":[]}
            """
        let connection = try #require(try decode(NotificationConnections.self, json).connections.first)
        guard case let .ntfy(settings) = connection.settings else {
            Issue.record("expected ntfy settings")
            return
        }
        #expect(settings.auth == .unknown("oauth"))
        #expect(!NotificationsFlow.isEditable(connection))
        #expect(NtfyDraft(editing: connection) == nil)
        #expect(NotificationsFlow.detail(connection).hasPrefix("ntfy \u{00B7} ntfy.sh/hub"))
        #expect(NotificationsFlow.detail(connection).hasSuffix(NotificationsFlow.newerAppEdits))
        #expect(NtfyAuth.choices == [.none, .token, .basic])
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
        #expect(!object.keys.contains("enabled"))
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

    @Test("a save never sends enabled, so only the row's switch turns a connection on or off")
    func saveNeverSendsEnabled() throws {
        let off = try savedConnections()[1]
        #expect(!off.enabled)
        let edit = try #require(NtfyDraft(editing: off))
        let create = NtfyDraft(offering: [.requestNeedsChooser])

        #expect(!(try encodedObject(edit.input)).keys.contains("enabled"))
        #expect(!(try encodedObject(create.input)).keys.contains("enabled"))
    }

    @Test("an edit that leaves the password blank sends the username and no password key")
    func editKeepingPasswordOmitsTheKey() throws {
        let draft = try #require(NtfyDraft(editing: try savedConnections()[1]))
        let settings = try encodedSettings(draft.input)
        #expect(settings["username"] as? String == "sam")
        #expect(!settings.keys.contains("password"))
        #expect(!settings.keys.contains("token"))
    }

    @Test("a server URL is sent as typed, trailing slash and all, with only the spaces trimmed")
    func serverURLSentAsTyped() throws {
        var draft = NtfyDraft(offering: [])
        draft.name = "Sub-path"
        draft.serverURL = "  https://example.com/ntfy/ "
        draft.topic = "t"
        #expect(try encodedSettings(draft.input)["server_url"] as? String == "https://example.com/ntfy/")
        #expect(try encodedSettings(draft.testRequest)["server_url"] as? String == "https://example.com/ntfy/")
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

    @Test("turning a connection on or off sends exactly one key, enabled")
    func enabledBodyIsOnlyEnabled() throws {
        let off = try encodedObject(NotificationConnectionEnabled(enabled: false))
        #expect(Set(off.keys) == ["enabled"])
        #expect(off["enabled"] as? Bool == false)
        let on = try encodedObject(NotificationConnectionEnabled(enabled: true))
        #expect(Set(on.keys) == ["enabled"])
        #expect(on["enabled"] as? Bool == true)
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
        #expect(R.setEnabled(id: 7) == NotificationRoute(method: "PATCH", path: "/api/admin/notifications/connections/7"))
        #expect(R.test == NotificationRoute(method: "POST", path: "/api/admin/notifications/test"))
    }

    @Test("a 404 means a server without these routes on the first read, and a deleted connection elsewhere")
    func notFoundWordingByPlace() {
        let notFound = APIError.http(status: 404, message: "no such notification connection")
        #expect(NotificationsFlow.isGone(notFound))
        #expect(!NotificationsFlow.isGone(APIError.http(status: 422, message: "x")))
        #expect(!NotificationsFlow.isGone(FakeFailure()))
        let load = NotificationsFlow.message(notFound, in: .load)
        #expect(load.contains("aren\u{2019}t available on this server"))
        #expect(!load.contains("Pull down"))
        #expect(NotificationsFlow.message(notFound, in: .list) == "That connection was deleted elsewhere.")
        #expect(NotificationsFlow.message(notFound, in: .sheet) == "This connection was deleted elsewhere.")
    }

    @Test("a refused value and a provider's answer are shown in the server's own words")
    func errorTextIsTheServers() {
        #expect(
            NotificationsFlow.message(APIError.http(status: 422, message: "public url must start with http:// or https://"))
                == "public url must start with http:// or https://"
        )
        // A provider's answer arrives as a whole sentence and is shown as it came.
        #expect(NotificationsFlow.message(APIError.http(status: 502, message: unauthorizedSentence)) == unauthorizedSentence)
        #expect(
            NotificationsFlow.message(APIError.http(status: 502, message: refusedConnectionSentence))
                == refusedConnectionSentence
        )
        #expect(NotificationsFlow.message(APIError.offline) == "You're offline.")
        #expect(NotificationsFlow.message(FakeFailure()) == "boom")
    }
}
