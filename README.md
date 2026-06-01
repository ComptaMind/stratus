# Stratus — AI Fiscal Agent

B2B SaaS AI agent for French VAT compliance. Takes a French FEC file, classifies VAT entries, computes the CA3 monthly VAT declaration, and generates the official EDI-TVA XML with a full audit trail.

## Stack

| Layer     | Technology                                          |
|-----------|-----------------------------------------------------|
| Frontend  | Next.js 15, React 19, Tailwind CSS 4, shadcn/ui, Clerk |
| API       | NestJS 10, Prisma 6, PostgreSQL 17                  |
| Agent     | Python 3.12, FastAPI, LangGraph, Anthropic, Mistral |
| Infra     | Docker Compose, Qdrant, Mailhog                     |
| Monorepo  | Turborepo, pnpm                                     |

## Setup

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm i -g pnpm`)
- Python 3.12
- Docker & Docker Compose

### 1. Clone & configure

```bash
git clone https://github.com/your-org/stratus.git
cd stratus
cp .env.example .env
# Fill in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, and AI keys in .env
```

### 2. Install JS dependencies

```bash
pnpm install
```

### 3. Start local services

```bash
docker compose -f infra/docker-compose.yml up -d
```

Services:
- PostgreSQL 17 → `localhost:5432`
- Qdrant vector DB → `localhost:6333`
- Mailhog SMTP → `localhost:1025` | Web UI → `http://localhost:8025`

### 4. Run database migrations

```bash
pnpm --filter api prisma migrate dev
```

### 5. Start all JS apps in dev mode

```bash
pnpm dev
```

- Web → `http://localhost:3000`
- API → `http://localhost:3001`

### 6. Start the Python agent (separate terminal)

```bash
cd apps/agent
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Agent → `http://localhost:8000`

## Development commands

```bash
pnpm dev          # Start all apps in dev mode
pnpm build        # Build all apps
pnpm typecheck    # TypeScript check across all packages
pnpm lint         # Lint all packages
pnpm test         # Run tests
```

## Project structure

```
stratus/
├── apps/
│   ├── web/        # Next.js 15 frontend (port 3000)
│   ├── api/        # NestJS 10 backend   (port 3001)
│   └── agent/      # Python FastAPI agent (port 8000)
├── packages/
│   ├── shared/          # Shared TypeScript types
│   └── eslint-config/   # Shared ESLint config
├── docs/           # PRD and product documentation
├── infra/          # Docker Compose & infra README
└── .github/
    └── workflows/ci.yml
```

## Clerk setup

1. Create a project at [clerk.com](https://clerk.com)
2. Enable Email/Password and any OAuth providers you want
3. Copy **Publishable Key** → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
4. Copy **Secret Key** → `CLERK_SECRET_KEY`
