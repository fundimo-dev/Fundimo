# Fundimo iOS

SwiftUI iOS app (iOS 17+) that connects to the Fundimo NestJS backend. The app uses cookie-based JWT auth (httpOnly); the Simulator talks to the backend at **http://127.0.0.1:3000/api**.

---

## 1. Run the backend

From the **monorepo root** (e.g. `BudgetingApp/`):

```bash
pnpm install
pnpm -C apps/api exec prisma migrate deploy
pnpm -C apps/api exec prisma db seed
pnpm -C apps/api start
```

The API runs at **http://127.0.0.1:3000** (or **http://localhost:3000**). The iOS app is configured to use **http://127.0.0.1:3000** for the Simulator.

---

## 2. Open the iOS project in Xcode

1. Open **Xcode**.
2. **File → Open** (or **Open a project or file**).
3. Navigate to:  
   `apps/ios/LedgerLensApp/LedgerLensApp.xcodeproj`  
   and open it.
4. The project is set up to use source files from the sibling folder **`LedgerLens`** (`apps/ios/LedgerLens/`). The **LedgerLens** group in the Project Navigator should show all Swift files (Models, Services, ViewModels, Views, Utilities). If you see missing (red) files, follow **Section 3** below.

---

## 3. If the LedgerLens source folder is not in the target (red/missing files)

If the **LedgerLens** group is empty or files are red, add the existing **LedgerLens** folder to the target:

1. In the **Project Navigator** (left sidebar), **right‑click** the **LedgerLensApp** group (the one that contains **LedgerLens** and **Products**).
2. Choose **“Add Files to ‘LedgerLensApp’…”**.
3. In the file picker, go to:  
   `apps/ios/LedgerLens`  
   (the folder that contains `LedgerLensApp.swift`, `Models/`, `Services/`, `ViewModels/`, `Views/`, `Utilities/`).
4. Select the **LedgerLens** folder (do **not** go inside it).
5. **Important:**
   - Leave **“Copy items if needed”** **unchecked** (we use the existing folder).
   - **“Add to targets:”** → check **LedgerLensApp**.
   - **“Create groups”** (not “Create folder references”).
6. Click **Add**.
7. In the Project Navigator you should now see the **LedgerLens** group with all Swift files. Ensure every `.swift` file under LedgerLens has **LedgerLensApp** in its **Target Membership** (select the file → File inspector → check **LedgerLensApp**).

---

## 4. App Transport Security (ATS)

The app target uses **LedgerLensApp/Info.plist**, which already allows HTTP to **127.0.0.1**:

- **NSAppTransportSecurity** → **NSExceptionDomains** → **127.0.0.1** → **NSExceptionAllowsInsecureHTTPLoads** = **YES**

No extra ATS steps are required if you use the provided project and Info.plist.

---

## 5. Build and run in the Simulator

1. Select the **LedgerLensApp** scheme (top bar).
2. Select an **iOS Simulator** (e.g. iPhone 16).
3. **Product → Run** (⌘R).
4. When the app launches, you should see the **Login** screen.

---

## 6. Simulator test checklist (demo credentials)

Use these credentials to verify the full flow:

- **Email:** `demo@fundimo.local`  
- **Password:** `Password123!`

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Start backend (Section 1), then run app in Simulator (Section 5). | App shows Login screen. |
| 2 | Enter demo email and password, tap **Sign In**. | Session is established via httpOnly cookie; app switches to the main tab UI (Dashboard, Transactions, Accounts, Settings). |
| 3 | Open **Accounts** tab. | List of accounts loads from **GET /accounts** (e.g. Chase, SoFi, Discover if seeded). |
| 4 | Open **Transactions** tab. | Transactions load from **GET /transactions** with default filters; list shows and “Load more” appears if there is a **nextCursor**. |
| 5 | Tap a transaction → change **Excluded from budget** or **Category** → **Save**. | **PATCH /transactions/:id** runs; list/detail reflects the update (e.g. `is_excluded` toggled or `category_id = null`). |
| 6 | Open **Settings** tab. | **GET /settings** loads; toggles show current values. |
| 7 | Toggle **Include pending in budget** or **Notify on pending**. | **PATCH /settings** is sent; a “Saved” (or similar) indication appears. |
| 8 | (Optional) Sign out from Settings, then sign in again with demo credentials. | Session persists via cookies; after login you see the main tabs again. |
| 9 | (Optional) Stop backend and trigger any API call (e.g. pull to refresh). | If the backend returns **401**, the app clears session and returns to the Login screen. |

---

## Implementation notes

- **Plaid**: **LinkKit** is included via Swift Package Manager (`plaid-link-ios-spm`). **PlaidService** calls `POST /plaid/link-token`, `POST /plaid/exchange`, and `POST /plaid/sync`; **PlaidLinkPresenter** presents the Plaid Link sheet and forwards the public token on success.
- **APIClient** (`Services/APIClient.swift`): `baseURL = "http://127.0.0.1:3000/api"`; uses default `URLSession` so **httpOnly cookies** are stored and sent automatically (no manual cookie reading).
- **SessionStore** (`Services/SessionStore.swift`): On launch calls **GET /me** to determine session; provides login/signup/logout; **handleAPIError** forces logout on **401**.
- **Transactions**: List uses **GET /transactions** with **cursor** and **nextCursor** for “Load more”; detail sheet and swipe actions use **PATCH /transactions/:id** for `is_excluded` and `category_id`.
- **Settings**: **GET /settings** and **PATCH /settings** for the two toggles; optimistic UI with “Saved” feedback.

---

## 7. Plaid Sandbox (Connect Bank + Sync)

The app can link real (sandbox) banks via Plaid and sync transactions.

### Backend requirements

- In `apps/api/.env` set Plaid and encryption env vars (see repo root **README → Plaid Sandbox**).
- Restart the API so `/plaid/link-token`, `/plaid/exchange`, and `/plaid/sync` are available.

### iOS: Plaid Link SDK (Swift Package Manager)

The project adds Plaid Link via SPM. If you opened the project before this was added:

1. In Xcode: **File → Add Package Dependencies…**
2. Enter: `https://github.com/plaid/plaid-link-ios-spm.git`
3. Add dependency to the **LedgerLensApp** target; use **LinkKit** (version “Up to Next Major” from 6.0.0).
4. Resolve and build.

### Using Plaid in the Simulator

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Backend running with Plaid env set; app logged in. | — |
| 2 | **Accounts** tab → **Connect Bank (Plaid)** (toolbar). | App requests link token; Plaid Link sheet opens. |
| 3 | In Plaid Link, choose **Plaid Sandbox** and sign in with `user_good` / `pass_good`. | Link succeeds; sheet dismisses; new PLAID accounts appear in the list. |
| 4 | **Transactions** tab → **Sync** (toolbar). | **POST /plaid/sync** runs; transactions list refreshes with synced items. |
| 5 | Cancel Plaid Link or trigger an error. | Sheet dismisses; inline error message appears (tap to dismiss). |

- **Mock accounts** (e.g. from **Add account** or seed) and **PLAID** accounts both appear on the Accounts screen.
- Access tokens are never sent to the client; they are encrypted and stored only on the backend.

---

## 8. OAuth institutions (real-bank flow)

For institutions like Chase that use OAuth:

1. Set backend env:
   - `PLAID_REDIRECT_URI=https://api.fundimo.com/api/plaid/oauth-redirect`
   - `PLAID_OAUTH_CONTINUE_URI=https://app.fundimo.com/plaid/continue`
2. Register `PLAID_REDIRECT_URI` in Plaid Dashboard allowed redirect URIs.
3. Configure iOS Associated Domains with your app domain (`applinks:app.fundimo.com`).
4. Host `apple-app-site-association` on your app domain.

The backend callback route `GET /api/plaid/oauth-redirect` forwards query params to `PLAID_OAUTH_CONTINUE_URI` when configured.
