# Bitespeed Identity Reconciliation

A backend service that identifies and consolidates customer identities across multiple purchases — even when different contact details are used each time.

Built as part of the [Bitespeed Backend Task](https://bitespeed.notion.site/Bitespeed-Backend-Task-Identity-Reconciliation-53392ab01fe149fab989422300423199).

---

## 🌐 Live Endpoint

```
POST https://bitespeed-identity-aau3.onrender.com/identify
```

---

## The Problem

FluxKart's customer Dr. Emmett Brown uses a different email and phone number for every purchase to stay under the radar. Bitespeed needs to figure out that all those orders belong to the same person — and link them together intelligently.

This service exposes a single `POST /identify` endpoint that accepts a contact's email and/or phone number, then returns a fully consolidated view of their identity — resolving which contact is the canonical "primary" and which are "secondary" aliases.

---

## How It Works

Every contact in the database is treated as a node in a graph. Two contacts are connected if they share either an email or a phone number. A group of connected contacts forms an **identity cluster**.

Each cluster must always satisfy three invariants:

- Exactly **one** contact has `linkPrecedence = "primary"` — always the oldest by `createdAt`
- All others have `linkPrecedence = "secondary"` with `linkedId` pointing directly to the primary
- No nested chains — every secondary references the canonical primary directly, never another secondary

When a request arrives, the service:
1. Finds all contacts matching the input email or phone
2. Collects their full identity cluster
3. Elects the oldest contact as canonical primary
4. Demotes any extra primaries and re-parents their secondaries
5. Creates a new secondary if the input introduces new information
6. Returns the consolidated cluster

Everything runs inside a single database transaction — either the whole operation succeeds or nothing changes.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express |
| ORM | Prisma |
| Database | PostgreSQL (Neon) |
| Validation | Zod |
| Testing | Jest + ts-jest + Supertest |

---

## API Reference

### `POST /identify`

Identifies a contact and returns their consolidated identity cluster.

**Request body** — at least one field is required:

```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

Both fields are optional individually, but at least one must be provided and non-null.

**Response `200 OK`:**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

Response guarantees:
- `emails[0]` is always the primary contact's email
- `phoneNumbers[0]` is always the primary contact's phone number
- `secondaryContactIds` is sorted ascending
- No duplicates in emails or phoneNumbers
- `primaryContactId` never appears in `secondaryContactIds`

**Validation error `400`:**

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email format" }
  ]
}
```

### `GET /health`

Health check endpoint — used by uptime monitors.

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Example Walkthrough

### Step 1 — First purchase

```bash
POST /identify
{ "email": "lorraine@hillvalley.edu", "phoneNumber": "123456" }
```

A new primary contact is created:

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": []
  }
}
```

### Step 2 — Second purchase with same phone, new email

```bash
POST /identify
{ "email": "mcfly@hillvalley.edu", "phoneNumber": "123456" }
```

The service recognises the shared phone number, creates a secondary contact, and returns the merged cluster:

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [2]
  }
}
```

### Step 3 — Two independent clusters get bridged

Suppose two completely separate primary contacts exist:

| id | email | phone | role |
|---|---|---|---|
| 11 | george@hillvalley.edu | 919191 | primary |
| 27 | biffsucks@hillvalley.edu | 717171 | primary |

A request arrives that matches both:

```bash
POST /identify
{ "email": "george@hillvalley.edu", "phoneNumber": "717171" }
```

The service merges both clusters, keeps the older one (id=11) as primary, demotes id=27 to secondary, and returns:

```json
{
  "contact": {
    "primaryContactId": 11,
    "emails": ["george@hillvalley.edu", "biffsucks@hillvalley.edu"],
    "phoneNumbers": ["919191", "717171"],
    "secondaryContactIds": [27]
  }
}
```

---

## Project Structure

```
bitespeed/
├── prisma/
│   ├── schema.prisma              # Contact model, LinkPrecedence enum, indexes
│   └── seed.ts                    # Test data covering all merge scenarios
│
├── src/
│   ├── lib/
│   │   ├── prisma.ts              # Singleton Prisma client
│   │   ├── logger.ts              # Structured JSON logger
│   │   └── env.ts                 # Startup environment validation
│   │
│   ├── repositories/
│   │   └── contact.repository.ts  # All database queries, typed and tx-safe
│   │
│   ├── services/
│   │   └── identity.service.ts    # Core identity resolution algorithm
│   │
│   ├── controllers/
│   │   └── identify.controller.ts # HTTP layer, Zod input validation
│   │
│   ├── __tests__/
│   │   └── identify.test.ts       # 38 integration tests across 9 scenarios
│   │
│   ├── app.ts                     # Express app, middleware, error handler
│   └── server.ts                  # Process entry point, graceful shutdown
│
├── .env.example                   # Required environment variables
├── .gitignore
├── jest.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Local Setup

### Prerequisites

- Node.js 18+
- A PostgreSQL database — [Neon](https://neon.tech) free tier works perfectly

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/bitespeed-identity
cd bitespeed-identity
npm install
```

### 2. Get your Neon connection strings

1. Sign up at [neon.tech](https://neon.tech) and create a new project
2. From the dashboard, copy two connection strings:
   - **Pooled** connection string (contains `pgbouncer=true`) — used at runtime
   - **Direct** connection string (no pgbouncer) — used for migrations

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Pooled — used by the app at runtime
DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/bitespeed?sslmode=require&pgbouncer=true&connect_timeout=15"

# Direct — used by Prisma CLI for migrations only
DIRECT_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/bitespeed?sslmode=require"

PORT=3000
NODE_ENV=development
```

### 4. Set up the database

```bash
npm run db:push       # creates the Contact table
npm run db:generate   # generates Prisma client + TypeScript types
npm run db:seed       # inserts test data
```

### 5. Start the server

```bash
npm run dev
```

You should see:
```json
{"level":"info","message":"server started","port":3000,"env":"development"}
```

### 6. Run the tests

```bash
npm test
```

Expected output:
```
Tests: 38 passed, 38 total
```

---

## Manual Testing

Once the server is running, try these curl commands:

```bash
# 1. Create a new contact
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"lorraine@hillvalley.edu","phoneNumber":"123456"}'

# 2. Link a new email to the same phone (creates secondary)
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"mcfly@hillvalley.edu","phoneNumber":"123456"}'

# 3. Merge two independent primaries
#    (run after seed — george and biffsucks are separate primaries)
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"george@hillvalley.edu","phoneNumber":"717171"}'

# 4. Idempotency check — run twice, response must be identical
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"lorraine@hillvalley.edu","phoneNumber":"123456"}'

# 5. Health check
curl http://localhost:3000/health
```

To inspect the database visually:

```bash
npm run db:studio
# Opens Prisma Studio at http://localhost:5555
```

---

## Deployment

### Deploy to Render

**1. Push your code to GitHub**

**2. Create a Web Service on Render**

Go to [render.com](https://render.com) → New → Web Service → connect your repo.

| Setting | Value |
|---|---|
| Runtime | `Node` |
| Build Command | `npm install && npm run db:push && npm run db:generate && npm run build` |
| Start Command | `npm start` |
| Instance Type | Free |

**3. Add environment variables**

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Neon **pooled** connection string |
| `DIRECT_URL` | Your Neon **direct** connection string |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

**4. Deploy**

Render builds and deploys automatically. The live URL will be:
```
https://bitespeed-identity.onrender.com
```

**5. Prevent cold starts with UptimeRobot**

Render's free tier sleeps after 15 minutes of inactivity, causing the first request to take ~30 seconds. Set up a free monitor at [uptimerobot.com](https://uptimerobot.com):

- Monitor type: `HTTP(s)`
- URL: `https://bitespeed-identity.onrender.com/health`
- Interval: `14 minutes`

This keeps the instance warm at no cost.

---

## Design Decisions

**Single transaction for all operations**

The entire identity resolution — reads, cluster fetching, primary election, demotions, and contact creation — runs inside a single `prisma.$transaction()`. This guarantees atomicity: either the full operation succeeds or nothing changes. There is no state that can be left partially applied.

**Flat `linkedId` invariant enforced on every write**

When a primary is demoted, its existing secondaries are re-parented to the canonical primary *before* the demotion update runs. This ensures no contact ever has a `linkedId` pointing to another secondary — the flat reference structure required by the spec is maintained after every single request.

**Canonical primary is fixed at election time**

The canonical primary is selected once — by sorting all primaries in the cluster by `createdAt` ascending and taking the first. It is never re-evaluated after secondary creation. This makes the algorithm fully deterministic: the same database state always produces the same result.

**Prisma client singleton**

A single `PrismaClient` instance is shared across the entire process lifetime via `src/lib/prisma.ts`. This prevents connection pool exhaustion that would occur if a new client were instantiated per request, and is safe with hot-reload in development.

**Zod validation at the boundary**

Input is validated and normalised — including whitespace trimming — at the controller layer before any business logic runs. The service layer has a secondary guard as a belt-and-suspenders check, but the controller is the primary enforcement point.

**`DIRECT_URL` split for Neon**

Neon uses PgBouncer connection pooling by default. PgBouncer does not support the prepared statements that Prisma's migration commands rely on. By splitting `DATABASE_URL` (pooled, for runtime) and `DIRECT_URL` (direct, for migrations), both use cases work correctly without any workarounds.

---

## Database Schema

```prisma
model Contact {
  id             Int            @id @default(autoincrement())
  email          String?        @db.VarChar(255)
  phoneNumber    String?        @db.VarChar(20)
  linkedId       Int?
  linkPrecedence LinkPrecedence
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  deletedAt      DateTime?

  linkedContact  Contact?  @relation("ContactLink", fields: [linkedId], references: [id])
  secondaryLinks Contact[] @relation("ContactLink")

  @@index([email])
  @@index([phoneNumber])
  @@index([linkedId])
}

enum LinkPrecedence {
  primary
  secondary
}
```

The `@@index([linkedId])` index is intentional — the most frequent query in the resolution algorithm is `WHERE linkedId IN (...)` to fetch a full cluster. Without this index that query is a full table scan.

---

## Test Coverage

38 integration tests across 9 scenarios, all running against a real PostgreSQL database:

| Scenario | Tests |
|---|---|
| New user creation | 6 |
| Add new email to existing phone | 2 |
| Add new phone to existing email | 2 |
| Two independent primaries merging | 4 |
| Transitive linking | 2 |
| Idempotency | 4 |
| Request matches a secondary contact | 2 |
| Response structure invariants | 5 |
| Input whitespace trimming | 2 |
| Validation | 9 |

---

## Scripts Reference

```bash
npm run dev          # Start development server with ts-node
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled production server
npm test             # Run all 38 integration tests
npm run db:push      # Push schema to database (no migration files)
npm run db:generate  # Generate Prisma client types
npm run db:migrate   # Run migrations (creates migration files)
npm run db:seed      # Seed database with test data
npm run db:studio    # Open Prisma Studio visual browser
```
