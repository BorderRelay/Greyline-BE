# Greyline-BE

Backend API repository for `Greyline`.

## Stack

- Node.js
- TypeScript
- Fastify
- PostgreSQL

## Baseline Tooling

- ESLint
- Prettier
- Husky
- lint-staged
- Vitest

## Purpose

This service is responsible for:

- account auth/session basics
- stash and loadout APIs
- NPC selling
- raid result persistence
- future marketplace APIs

## Related Docs

Implementation and design specs live in:

- `BorderRelay/Greyline-Project-Docs`

Key docs:

- `backend-api-implementation-spec.md`
- `database-schema-implementation-spec.md`
- `backend-server-foundation-spec.md`
- `final-rdb-structure-with-marketplace.md`

## Scripts

- `npm run dev`
- `npm run server:dev`
- `npm run server:start`
- `npm run build`
- `npm run start`
- `npm run check`
- `npm run lint`
- `npm run lint:fix`
- `npm run format`
- `npm run format:check`
- `npm run test`
- `npm run db:bootstrap`
- `npm run db:migrate`

## Environment

Create a local `.env` from `.env.example` before running the server.

Core env keys:

- `DATABASE_URL`
- `DATABASE_SCHEMA`
- `LOG_LEVEL`
- `CORS_ORIGIN`
- `SWAGGER_ENABLED`
- `SWAGGER_ROUTE_PREFIX`

## Local PostgreSQL

The backend connects to a single standalone PostgreSQL Docker container named `postgres-sql` that is not managed by compose.
The container exposes `5432` on the host and the service uses its own schema inside the shared database.
The container is created and updated with Docker restart policy `always` so it comes back after daemon or host restarts.
`npm run dev` first tries the configured `DATABASE_URL`. If the database is not reachable and the target is local, it starts the managed Docker container and then runs migrations before starting the server.

Commands:

- `npm run db:bootstrap`
- `npm run db:up`
- `npm run db:status`
- `npm run db:down`
- `npm run db:migrate`

Default schema:

- `greyline_be`

## Schema Management

Schema changes are managed through SQL migration files in `migrations/`.
`npm run db:migrate` applies unapplied migrations in filename order and records them in `greyline_be.schema_migrations`.

## Server Baseline

The backend now uses a plugin-based Fastify baseline with:

- TypeBox route schemas
- shared error envelope
- PostgreSQL startup verification
- Swagger/OpenAPI generation
- development-only Swagger UI by default at `/documentation`
- auth context stub for future protected routes
