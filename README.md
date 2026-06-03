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
- `final-rdb-structure-with-marketplace.md`

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run check`
- `npm run lint`
- `npm run lint:fix`
- `npm run format`
- `npm run format:check`
- `npm run test`

## Environment

Create a local `.env` from `.env.example` before running the server.
