# Fundimo System Design

High-level architecture, data flow, and UML-style diagrams for the API and iOS app.

---

## 1. High-Level Architecture

```mermaid
flowchart TB
  subgraph client [iOS App - Swift/SwiftUI]
    Views[Views]
    ViewModels[ViewModels]
    Services[Services]
    Views --> ViewModels
    ViewModels --> Services
  end

  subgraph api [Backend - NestJS / TypeScript]
    Controllers[Controllers]
    ServicesAPI[Services]
    Guards[Guards]
    Controllers --> Guards
    Controllers --> ServicesAPI
  end

  subgraph external [External]
    Postgres[(PostgreSQL)]
    Plaid[Plaid API]
  end

  Services -->|"HTTP + cookies"| Controllers
  ServicesAPI --> Postgres
  ServicesAPI --> Plaid
```

- **iOS app**: Swift/SwiftUI. Views bind to ViewModels; ViewModels call Services (e.g. `APIClient`, `PlaidService`). All API calls go over HTTP with cookies.
- **Backend**: NestJS. Controllers handle routes; `JwtAuthGuard` protects most routes; Services contain business logic and talk to Postgres (Prisma) and Plaid.
- **Data**: PostgreSQL holds users, accounts, transactions, categories, rules, budgets, notifications. Plaid holds bank linkage and transaction sync (sandbox or live).

---

## 2. Backend Module Structure

```mermaid
flowchart LR
  AppModule[AppModule]
  ConfigModule[ConfigModule]
  PrismaModule[PrismaModule]
  AuthModule[AuthModule]
  AccountsModule[AccountsModule]
  TransactionsModule[TransactionsModule]
  SettingsModule[SettingsModule]
  CategoriesModule[CategoriesModule]
  BudgetsModule[BudgetsModule]
  RulesModule[RulesModule]
  NotificationsModule[NotificationsModule]
  SyncModule[SyncModule]
  PlaidModule[PlaidModule]

  AppModule --> ConfigModule
  AppModule --> PrismaModule
  AppModule --> AuthModule
  AppModule --> AccountsModule
  AppModule --> TransactionsModule
  AppModule --> SettingsModule
  AppModule --> CategoriesModule
  AppModule --> BudgetsModule
  AppModule --> RulesModule
  AppModule --> NotificationsModule
  AppModule --> SyncModule
  AppModule --> PlaidModule
```

- **ConfigModule**: Loads `apps/api/.env`; provides `ConfigService` globally.
- **PrismaModule**: Provides `PrismaService` for DB access.
- **AuthModule**: Login, signup, logout, JWT issue/validate, `GET /me`. Uses httpOnly cookie for JWT.
- **AccountsModule**: List accounts, mock-link (MOCK provider).
- **TransactionsModule**: List (paginated), update (category, is_excluded).
- **SettingsModule**: Get/patch user settings (include_pending_in_budget, notify_on_pending).
- **CategoriesModule**: List categories.
- **BudgetsModule**, **RulesModule**, **NotificationsModule**, **SyncModule**: Domain features.
- **PlaidModule**: Link token, exchange public token, sync transactions (Plaid API + encrypted storage).

All API routes are under the global prefix **`/api`** (set in `main.ts`).

---

## 3. API Routes Overview

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST   | /api/auth/signup     | No  | Register; sets httpOnly cookie |
| POST   | /api/auth/login      | No  | Login; sets httpOnly cookie |
| POST   | /api/auth/logout     | No  | Clear cookie |
| GET    | /api/me              | Yes | Current user (validates cookie) |
| GET    | /api/accounts        | Yes | List connected accounts |
| POST   | /api/accounts/mock-link | Yes | Add MOCK account |
| GET    | /api/transactions    | Yes | List (query: month, accountId, status, q, cursor, includeExcluded) |
| PATCH  | /api/transactions/:id | Yes | Update category / is_excluded |
| GET    | /api/settings        | Yes | User settings |
| PATCH  | /api/settings        | Yes | Update settings |
| GET    | /api/categories      | Yes | List categories |
| POST   | /api/plaid/link-token | Yes | Get Plaid Link token |
| POST   | /api/plaid/exchange  | Yes | Exchange public token; create PlaidItem + ConnectedAccounts |
| POST   | /api/plaid/sync      | Yes | Sync transactions from Plaid |

Protected routes use **JwtAuthGuard**: JWT is read from the **httpOnly cookie** (name from `AUTH_COOKIE_NAME`), validated with `JWT_SECRET`, and the payload (`sub`, `email`) is attached to the request.

---

## 4. Authentication Flow

```mermaid
sequenceDiagram
  participant User
  participant iOS
  participant APIClient
  participant AuthController
  participant AuthService
  participant DB[(Postgres)]

  User->>iOS: Enter email/password, tap Sign In
  iOS->>APIClient: POST /api/auth/login, body
  APIClient->>AuthController: HTTP + JSON
  AuthController->>AuthService: login(dto)
  AuthService->>DB: Find user, verify password
  DB-->>AuthService: user
  AuthService->>AuthService: Sign JWT (sub, email)
  AuthService-->>AuthController: { user, token }
  AuthController->>AuthController: Set-Cookie (httpOnly, SameSite)
  AuthController-->>APIClient: 200 + JSON user + Set-Cookie
  APIClient-->>iOS: Response (cookies stored by URLSession)
  iOS->>APIClient: GET /api/me (cookie sent automatically)
  APIClient->>AuthController: GET /api/me + Cookie
  Note over AuthController: JwtAuthGuard reads cookie, validates JWT
  AuthController-->>APIClient: 200 + user
  iOS->>User: Show main tabs
```

- **Login**: iOS sends credentials to `POST /api/auth/login`. Backend returns JWT in an **httpOnly** cookie and a JSON user. iOS does not read the token; the system stores the cookie and sends it on subsequent requests.
- **Session check**: On launch, iOS calls `GET /api/me` with the cookie. If the guard validates the JWT, the app shows the main UI; if 401, it shows login.
- **Protected calls**: Every request to a guarded route (accounts, transactions, plaid, etc.) sends the same cookie; `JwtStrategy` extracts the JWT from the cookie and attaches the user payload to the request.

---

## 5. Plaid Link Flow (Sandbox)

```mermaid
sequenceDiagram
  participant User
  participant iOS
  participant PlaidService
  participant APIClient
  participant PlaidController
  participant PlaidServiceAPI[PlaidService]
  participant PlaidAPI[Plaid API]
  participant DB[(Postgres)]

  User->>iOS: Tap "Connect Bank (Plaid)"
  iOS->>PlaidService: getLinkToken()
  PlaidService->>APIClient: POST /api/plaid/link-token (cookie)
  APIClient->>PlaidController: Request
  PlaidController->>PlaidServiceAPI: createLinkToken(userId)
  PlaidServiceAPI->>PlaidAPI: linkTokenCreate(...)
  PlaidAPI-->>PlaidServiceAPI: link_token
  PlaidServiceAPI-->>PlaidController: { link_token }
  PlaidController-->>APIClient: 200 + JSON
  APIClient-->>iOS: link_token
  iOS->>iOS: Present Plaid Link (LinkKit) with token
  User->>iOS: Complete Link in sandbox (e.g. user_good / pass_good)
  iOS->>iOS: Receive public_token from LinkKit
  iOS->>PlaidService: exchange(publicToken)
  PlaidService->>APIClient: POST /api/plaid/exchange, { public_token }
  APIClient->>PlaidController: Request
  PlaidController->>PlaidServiceAPI: exchangePublicToken(userId, public_token)
  PlaidServiceAPI->>PlaidAPI: itemPublicTokenExchange
  PlaidAPI-->>PlaidServiceAPI: access_token, item_id
  PlaidServiceAPI->>PlaidServiceAPI: Encrypt access_token, store in DB
  PlaidServiceAPI->>PlaidAPI: accountsGet(access_token)
  PlaidAPI-->>PlaidServiceAPI: accounts
  PlaidServiceAPI->>DB: Create PlaidItem + ConnectedAccounts (provider PLAID)
  PlaidServiceAPI-->>PlaidController: { accounts }
  PlaidController-->>APIClient: 200 + accounts
  iOS->>iOS: Refresh accounts list
```

- **link-token**: iOS requests a link token from the backend; backend calls Plaid’s `linkTokenCreate` and returns the token. No secrets are sent to the client.
- **Link UI**: iOS uses LinkKit to show Plaid’s UI; user completes sandbox (or real) bank link; LinkKit returns a **public_token**.
- **exchange**: iOS sends the public_token to `POST /api/plaid/exchange`. Backend exchanges it for an access_token, encrypts and stores it (PlaidItem), fetches accounts from Plaid, and creates ConnectedAccount rows. Response is the list of accounts only (no tokens).
- **sync**: User can tap Sync; iOS calls `POST /api/plaid/sync`. Backend uses stored (decrypted) access tokens and Plaid’s transactions/sync API to update local transactions.

---

## 6. Data Model (Simplified)

```mermaid
erDiagram
  User ||--o{ ConnectedAccount : has
  User ||--o{ Transaction : has
  User ||--o{ PlaidItem : has
  User ||--o{ Budget : has
  User ||--o{ Rule : has
  User ||--o{ Notification : has

  PlaidItem ||--o{ ConnectedAccount : "1 item, N accounts"
  ConnectedAccount ||--o{ Transaction : has

  Category ||--o{ Transaction : categorizes
  Category ||--o{ Budget : has
  Category ||--o{ Rule : assigns

  User {
    uuid id PK
    string email
    string password_hash
    bool include_pending_in_budget
    bool notify_on_pending
  }

  ConnectedAccount {
    uuid id PK
    uuid user_id FK
    enum provider "MOCK|PLAID|CHASE|..."
    string name
    enum type "CHECKING|CREDIT|..."
    uuid plaid_item_id FK "nullable"
    string plaid_account_id "nullable"
  }

  PlaidItem {
    uuid id PK
    uuid user_id FK
    string item_id "Plaid"
    string access_token_ciphertext
    string cursor "sync cursor"
  }

  Transaction {
    uuid id PK
    uuid user_id FK
    uuid account_id FK
    int amount_cents
    string merchant_name
    enum status "PENDING|POSTED"
    uuid category_id FK "nullable"
    bool is_excluded
    string provider_transaction_id "Plaid id"
  }

  Category {
    uuid id PK
    string name
    string group
  }
```

- **User**: One-to-many with accounts, transactions, PlaidItems, budgets, rules, notifications.
- **PlaidItem**: One per Plaid “item” (one bank connection); holds encrypted access_token and sync cursor; one-to-many ConnectedAccounts.
- **ConnectedAccount**: Either MOCK (no Plaid) or PLAID (linked to a PlaidItem and optional plaid_account_id).
- **Transaction**: Belongs to user and account; optional category; can be excluded from budget; provider_transaction_id used for Plaid deduplication.

---

## 7. iOS App Structure

```mermaid
flowchart TB
  subgraph entry [Entry]
    LedgerLensApp[LedgerLensApp]
    RootView[RootView]
    LedgerLensApp --> RootView
  end

  subgraph auth_flow [Auth Flow]
    AuthStackView[AuthStackView]
    LoginView[LoginView]
    SignupView[SignupView]
    AuthViewModel[AuthViewModel]
    RootView --> AuthStackView
    AuthStackView --> LoginView
    AuthStackView --> SignupView
    LoginView --> AuthViewModel
    SignupView --> AuthViewModel
  end

  subgraph main [Main Tabs - Authenticated]
    MainTabView[MainTabView]
    DashboardView[DashboardView]
    TransactionsView[TransactionsView]
    AccountsView[AccountsView]
    SettingsView[SettingsView]
    RootView --> MainTabView
    MainTabView --> DashboardView
    MainTabView --> TransactionsView
    MainTabView --> AccountsView
    MainTabView --> SettingsView
  end

  subgraph viewmodels [ViewModels]
    DashboardViewModel[DashboardViewModel]
    TransactionsViewModel[TransactionsViewModel]
    AccountsViewModel[AccountsViewModel]
    SettingsViewModel[SettingsViewModel]
  end

  subgraph services [Services]
    SessionStore[SessionStore]
    APIClient[APIClient]
    PlaidService[PlaidService]
  end

  DashboardView --> DashboardViewModel
  TransactionsView --> TransactionsViewModel
  AccountsView --> AccountsViewModel
  SettingsView --> SettingsViewModel

  AuthViewModel --> SessionStore
  DashboardViewModel --> SessionStore
  TransactionsViewModel --> SessionStore
  AccountsViewModel --> SessionStore
  SettingsViewModel --> SessionStore

  SessionStore --> APIClient
  AuthViewModel --> APIClient
  DashboardViewModel --> APIClient
  TransactionsViewModel --> APIClient
  AccountsViewModel --> APIClient
  SettingsViewModel --> APIClient
  AccountsViewModel --> PlaidService
  TransactionsViewModel --> PlaidService
  PlaidService --> APIClient
```

- **RootView**: Reads `SessionStore.state` (unknown / authenticated / unauthenticated). Shows loading, auth stack, or main tabs.
- **SessionStore**: Owns session state; calls `GET /api/me` on launch; provides login/signup/logout and forwards API calls through `APIClient`. Cookies are managed by `URLSession` (no manual cookie handling).
- **APIClient**: Single `baseURL` (e.g. `http://127.0.0.1:3000/api`); all requests send cookies; decodes JSON and maps errors (e.g. 401 → SessionStore can force logout).
- **PlaidService**: Thin wrapper over `APIClient` for `/api/plaid/link-token`, `/api/plaid/exchange`, `/api/plaid/sync`. Used by AccountsViewModel (link) and TransactionsViewModel (sync).
- **Views**: SwiftUI; each tab has a View and a ViewModel; ViewModels call services and expose `@Published` state for the views.

---

## 8. Request Flow (Example: List Transactions)

```mermaid
sequenceDiagram
  participant User
  participant TransactionsView
  participant TransactionsViewModel
  participant APIClient
  participant TransactionsController
  participant TransactionsService
  participant Prisma
  participant DB[(Postgres)]

  User->>TransactionsView: Open tab or pull-to-refresh
  TransactionsView->>TransactionsViewModel: load(append: false)
  TransactionsViewModel->>APIClient: GET /api/transactions?month=...&limit=20&...
  APIClient->>APIClient: Attach cookie (URLSession)
  APIClient->>TransactionsController: HTTP GET + Cookie
  TransactionsController->>TransactionsController: JwtAuthGuard validates cookie
  TransactionsController->>TransactionsService: list(userId, query)
  TransactionsService->>Prisma: findMany with filters, cursor
  Prisma->>DB: SQL
  DB-->>Prisma: rows
  Prisma-->>TransactionsService: transactions
  TransactionsService-->>TransactionsController: { data, nextCursor }
  TransactionsController-->>APIClient: 200 + JSON
  APIClient-->>TransactionsViewModel: TransactionListResponse
  TransactionsViewModel->>TransactionsViewModel: transactions = response.data
  TransactionsView->>User: Render list
```

Same pattern for other list/update endpoints: ViewModel calls APIClient with path and query/body; Guard validates JWT from cookie; Controller delegates to Service; Service uses Prisma and returns DTOs.

---

## 9. Technology Choices (Brief)

| Layer | Technology | Why |
|-------|------------|-----|
| Backend | NestJS (TypeScript) | Structure (modules, guards, DI), good fit for APIs and middleware (cookies, validation, filters). |
| API auth | JWT in httpOnly cookie | No token in JS/localStorage; cookie sent automatically; SameSite reduces CSRF. |
| DB | PostgreSQL + Prisma | Relational data (users, accounts, transactions); Prisma gives typed client and migrations. |
| iOS | SwiftUI + Swift | Native app; ViewModels + Services keep API and state logic out of views. |
| Plaid | LinkKit (iOS) + Plaid Node SDK (API) | Official SDKs; token exchange and storage stay on backend; encryption for access tokens. |

---

## 10. File Roles (Quick Reference)

| Area | Key files | Role |
|------|-----------|------|
| API entry | `apps/api/src/main.ts` | Load env, create app, global prefix `/api`, CORS, cookie parser, filters, pipes, listen. |
| API wiring | `apps/api/src/app.module.ts` | Imports all feature modules; ConfigModule + PrismaModule. |
| Auth API | `auth.controller.ts`, `auth.service.ts`, `jwt.strategy.ts`, `auth.guard.ts` | Login/signup/logout/me; JWT from cookie; guard for protected routes. |
| Plaid API | `plaid.controller.ts`, `plaid.service.ts`, `plaid.config.ts` | link-token, exchange, sync; env validation; encryption. |
| Data | `prisma/schema.prisma` | Models and relations; migrations apply to Postgres. |
| iOS entry | `LedgerLensApp.swift`, `RootView.swift` | App entry; root view switches on SessionStore state. |
| iOS auth | `SessionStore.swift`, `AuthViewModel.swift`, `LoginView.swift` | Session state; login/signup; cookie sent via APIClient. |
| iOS API | `APIClient.swift`, `PlaidService.swift` | All HTTP to backend; Plaid endpoints. |
| iOS main UI | `MainTabView.swift`, `*View.swift`, `*ViewModel.swift` | Tabs; each screen has View + ViewModel calling APIClient/PlaidService. |

This document reflects the current system; for OAuth redirect and production deployment (domain, Universal Links), see the project README and any OAuth/domain plan.
