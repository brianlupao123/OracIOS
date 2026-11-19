# ORAC-IOS — Industrial Operations System

> **Enterprise Operations ERP for Heavy Mining Plant Maintenance & Contracting Operations in Zimbabwe.**  
> Built for heavy engineering contractors serving major mining houses (Zimplats, Unki, Mimosa). Single source of operational truth replacing fragmented paperwork and Sage Pastel with a role-based, USD-only platform.

---

## Live Deployed Architecture & Endpoints

| Tier | Platform | Service / Target | Live Deployed URL |
| :--- | :--- | :--- | :--- |
| **Backend API** | **Fly.io** | `orac-operations-api` (Region `jnb` - Johannesburg) | [`https://orac-operations-api.fly.dev`](https://orac-operations-api.fly.dev) |
| **Frontend Portal** | **Render** | `orac-industrial-service-portal` (Static SPA) | [`https://orac-industrial-service-portal.onrender.com`](https://orac-industrial-service-portal.onrender.com) |
| **Public Website** | **Vercel** | Marketing & Client Ingress Demo (*Separate Repo*) | [`https://orac-system-web.vercel.app`](https://orac-system-web.vercel.app) |

* **Ingress Connection:** The public website on Vercel submits client inquiries and service bookings directly to `POST https://orac-operations-api.fly.dev/api/leads`.
* **Portal Connection:** The React portal on Render connects to `https://orac-operations-api.fly.dev/api` via `VITE_API_BASE_URL`.

---

## Verified Technology Stack (From Scanned Source Code)

### Backend Service (`orac-backend`)
* **Runtime:** Node.js (Strict ESM `"type": "module"`)
* **HTTP Framework:** Express 5 (`^5.2.1`)
* **Schema Validation:** Zod (`^4.5.4`)
* **Security & Auth:** bcrypt (`^6.0.0`), jsonwebtoken (`^9.0.3`), RFC 6238 TOTP Two-Factor Authentication
* **Database Driver:** `pg` (`^8.23.0`) for PostgreSQL
* **Production Persistence:** PostgreSQL with SSL (`STORE_DRIVER=postgres`)
* **Development Persistence:** Atomic file-backed JSON store with mutex lock serialization (`data/store.json`, `STORE_DRIVER=json`)
* **Architecture:** **20 domain modules** (`src/modules/*`), 89-line central ingress router (`src/router.js`), array-only BaseService storage

### Frontend Portal (`orac-ios-frontend`)
* **UI Library:** React 18 (`^18.3.1`) & React DOM
* **Routing:** React Router 6 (`^6.26.0`)
* **Build System:** Vite 5 (`^5.3.1`)
* **Styling:** Tailwind CSS 3 (`^3.4.4`), PostCSS, Autoprefixer
* **Document Engine:** `pdf-lib` (`^1.17.1`) for in-browser PDF generation
* **Offline Engine:** Service Worker PWA (`public/sw.js`) with single-flight idempotent outbox sync (`src/offlineOutboxSync.js`)
* **Architecture:** **14 domain feature slices** (`src/features/*`), scoped API clients (`src/api/*`), USD-only currency formatting

---

## Monorepo Repository Structure

```
OracIOS/
├── orac-backend/           # Node.js Express 5 API (20 domain modules, 89-line router)
│   ├── fly.toml            # Fly.io production configuration (app: orac-operations-api)
│   ├── render.yaml         # Render configuration fallback
│   ├── Dockerfile          # Production multi-stage container
│   ├── src/                # 20 domain modules, services, schema validators
│   └── tests/              # 210 test files (2,269 passing tests)
├── orac-ios-frontend/      # React 18 + Vite Industrial Portal (14 feature slices)
│   ├── render.yaml         # Render production configuration (app: orac-industrial-service-portal)
│   ├── Dockerfile          # Production multi-stage container
│   ├── src/                # Feature slices, UI primitives, offline PWA engine
│   └── tests/              # 100 test files (740 passing tests)
├── docs/                   # Full-stack architectural blueprints and truth documents
│   ├── ORAC_LOCKED_FULL_STACK_ARCHITECTURE.md
│   ├── ORAC_MASTER_MEMORY_AND_TRUTH_DOCUMENT.md
│   └── ORAC_IOS_GIT_OPERATIONS_AND_ARCHITECTURE_GUIDE.md
├── .github/workflows/      # Automated CI/CD pipelines (backend-ci.yml, frontend-ci.yml)
├── docker-compose.yml      # Local container orchestration
└── README.md
```

---

## Local Setup & Quick Start

```bash
# Clone the repository (Strict PascalCase, zero hyphens)
git clone https://github.com/brianlupao123/OracIOS.git
cd OracIOS

# 1. Start Backend API (Port 5050 / 8080)
cd orac-backend
cp .env.example .env
npm install
npm run dev

# 2. Start Frontend Portal (Port 5173) in a second terminal
cd ../orac-ios-frontend
cp .env.example .env
npm install
npm run dev
```

---

## Automated Verification & Test Suites

The entire codebase is validated against strict automated test suites:

```bash
# Backend test suite (210 test files, 2,269 passing tests, 0 failing)
cd orac-backend
npm test

# Frontend test suite (100 test files, 740 passing tests, 0 failing)
cd orac-ios-frontend
npm test

# Frontend production Vite build (12.91s clean bundle)
cd orac-ios-frontend
npm run build
```

---

## Architecture & System Documentation

- [Locked Full-Stack Architecture](docs/ORAC_LOCKED_FULL_STACK_ARCHITECTURE.md)
- [Master Memory & Truth Document](docs/ORAC_MASTER_MEMORY_AND_TRUTH_DOCUMENT.md)
- [Git Operations & Developer Handbook](docs/ORAC_IOS_GIT_OPERATIONS_AND_ARCHITECTURE_GUIDE.md)

---

## License

Proprietary — ORAC Systems (Pvt) Ltd. All rights reserved.
