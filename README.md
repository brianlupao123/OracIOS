# ORAC Industrial Operations System

> **Full-stack ERP platform for industrial mining operations in Zimbabwe.**
> Replacing Sage Pastel with a modern, role-based, USD-only operational management system.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/<org>/orac-ios.git
cd orac-ios

# Start backend
cd orac-backend
cp .env.example .env
npm install
npm run dev

# Start frontend (new terminal)
cd orac-ios-frontend
cp .env.example .env
npm install
npm run dev
```

## Repository Structure

```
orac-ios/
├── orac-backend/           Node.js Express API (14 domain modules)
├── orac-ios-frontend/      React 18 + Vite Portal (14 feature slices)
├── docs/                   System-wide documentation
├── .github/workflows/      CI/CD pipelines
└── docker-compose.yml      One-command local dev environment
```

## Documentation

- [Architecture Blueprint](docs/ARCHITECTURE.md)
- [Master Memory & Configuration](docs/MASTER_MEMORY.md)
- [API Contracts](docs/API_CONTRACTS.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, ESM, Zod, bcrypt, pg, jsonwebtoken |
| Frontend | React 18, React Router 6, Vite, Tailwind CSS |
| Database | PostgreSQL (Neon) / In-memory JSON (dev) |
| Hosting | Fly.io (backend) / Vercel or Fly.io (frontend) |

## Running Tests

```bash
# Backend tests (205+ test files)
cd orac-backend && npm test

# Frontend tests (740 tests)
cd orac-ios-frontend && npm test
```

## License

Proprietary — ORAC Systems (Pvt) Ltd. All rights reserved.
