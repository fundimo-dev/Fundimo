import Foundation

@MainActor
final class SessionStore: ObservableObject {
    enum State {
        case unknown
        case authenticated(UserMe)
        case unauthenticated
    }

    @Published private(set) var state: State = .unknown
    @Published private(set) var lastOAuthCallbackURL: URL?
    private let client = APIClient.shared

    var isLoggedIn: Bool {
        if case .authenticated = state { return true }
        return false
    }

    var currentUser: UserMe? {
        if case .authenticated(let user) = state { return user }
        return nil
    }

    func checkSession() async {
        do {
            let user: UserMe = try await client.request(path: "/me")
            state = .authenticated(user)
        } catch {
            state = .unauthenticated
        }
    }

    func login(email: String, password: String) async throws {
        struct LoginBody: Encodable {
            let email: String
            let password: String
        }
        try await client.requestVoid(path: "/auth/login", method: "POST", body: LoginBody(email: email, password: password))
        let user: UserMe = try await client.request(path: "/me")
        state = .authenticated(user)
    }

    func signup(email: String, password: String) async throws {
        struct SignupBody: Encodable {
            let email: String
            let password: String
        }
        try await client.requestVoid(path: "/auth/signup", method: "POST", body: SignupBody(email: email, password: password))
        let user: UserMe = try await client.request(path: "/me")
        state = .authenticated(user)
    }

    func logout() async {
        try? await client.requestVoid(path: "/auth/logout", method: "POST")
        state = .unauthenticated
    }

    func forceLogout() {
        state = .unauthenticated
    }

    /// Receives Universal Link callbacks used by OAuth institutions.
    func handleOAuthCallback(url: URL) {
        lastOAuthCallbackURL = url
    }

    /// Call from ViewModels when an API call fails; if 401, forces logout.
    func handleAPIError(_ error: Error) {
        if case APIError.httpStatus(401, _) = error {
            forceLogout()
        }
    }
}
