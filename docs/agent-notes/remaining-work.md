# 백엔드 스펙 대비 구현 격차 분석 (2026-07-17)

## 조사 범위와 방법

- 대조 대상 스펙: `Greyline-Project-Docs/docs/backend-api-implementation-spec.md`, `database-schema-implementation-spec.md`, `final-rdb-structure-with-marketplace.md`, `backend-architecture-spec.md`
- 대조 대상 코드: `main`은 초기 스캐폴드만 있어 `develop` 및 아직 `develop`에 머지되지 않은 `feat/loadout-api`(가장 최신 상태, `feat/stash-api`를 포함)를 기준으로 확인함. `git show <branch>:<path>`, `git ls-tree -r <branch>`로 브랜치 전환 없이 조사.
- `main` 브랜치는 건드리지 않았고, 어떤 앱 코드도 수정하지 않음 — 문서 추가와 GitHub 이슈 생성만 수행.

## 브랜치 현황 (참고)

- `develop`: auth(로그인/로그아웃/logout-all/refresh/register) + fastify 기반(cors/sensible/db/authContext/openapi) + core 마이그레이션까지만 머지됨
- `feat/stash-api`: `develop` + `GET /api/stash`
- `feat/loadout-api`: `feat/stash-api` + `GET /api/loadout`, `POST /api/loadout/equip`, `POST /api/loadout/unequip` — 아직 `develop`에 머지 안 됨 (merge-ready)
- 위 세 브랜치 모두 `migrations/0001~0003`은 동일 — marketplace 테이블(`marketplace_listings`, `marketplace_purchases`, `marketplace_purchase_items`)까지 이미 포함되어 있음 (스키마상으로는 marketplace 대비 완료, API는 별도)

## 구현 완료로 확인된 것 (재플래그 금지 대상)

- Fastify 파운데이션: `cors → sensible → db → authContext → openapi` 플러그인 순서 확인 (`src/app.ts`)
- JWT 세션 인증: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `POST /api/auth/refresh` — `src/routes/api/auth/`
- 계정 가입: `POST /api/auth/register` — `src/routes/api/auth/register.ts`, 계정 생성 시 `account_profiles` + 기본 4개 `loadout_slots` row 트랜잭션 내 생성 확인 (`src/repositories/account.repository.ts` `createAccount()`) — DB 스펙 §26 요구사항 충족
- 스태시 조회: `GET /api/stash` — `src/routes/api/stash/index.ts`, `src/repositories/stash.repository.ts`
- 로드아웃 조회/장착/해제: `GET /api/loadout`, `POST /api/loadout/equip`, `POST /api/loadout/unequip` — `src/routes/api/loadout/index.ts`, `src/repositories/loadout.repository.ts`
- DB 마이그레이션: `accounts`, `account_profiles`, `item_definitions`, `inventory_items`, `loadout_slots`, `raid_results`, `raid_result_items`, `npc_sales`, `npc_sale_items`, `marketplace_listings`, `marketplace_purchases`, `marketplace_purchase_items`, `account_sessions` 전부 존재 (`migrations/0002_tables.sql`, `0003_sessions.sql`). 스펙에 명시된 인덱스(§13 required indexes)도 전부 존재.

## 확인된 격차 (이슈 생성 완료)

### 1. NPC 판매 API 미구현 — issue #7

- `POST /api/sell/item`(스펙 §14), `POST /api/sell/bulk`(스펙 §15) 라우트가 어느 브랜치에도 없음 — `git ls-tree -r <branch> | grep -i sell` 전 브랜치 무결과
- `npc_sales`/`npc_sale_items` 테이블은 마이그레이션에 존재하지만 이를 사용하는 repository/service 없음
- 서버 authoritative 가격 계산, all-or-nothing bulk 트랜잭션 등 스펙 §19 (`sellSingleItem`, `sellBulkItems`) 요구사항 전부 미구현

### 2. 레이드 결과 제출 API 미구현 — issue #8

- `POST /api/raid-results`(스펙 §16)가 어느 브랜치에도 없음 — `git ls-tree -r <branch> | grep -i raid` 전 브랜치 무결과
- `raid_results`/`raid_result_items` 테이블은 존재하지만 사용하는 코드가 없음
- `raidId` 기준 멱등성 처리(스펙 §16 Idempotency rule), 성공/실패 트랜잭션 분기(DB 스펙 §20-21), 스택 병합 규칙(§22) 모두 미구현

### 3. item_definitions 시드 데이터 부재 — issue #9

- DB 스펙 §15 Seed Data Rules에 명시된 최소 시드(권총/소총/탄약/의료/식품/부품/귀중품)가 어디에도 없음 — 저장소 전체에 `seed` 파일명 자체가 없음
- 이 상태로는 스태시/로드아웃/판매/레이드결과 흐름을 실제 데이터로 검증 불가 (item_definitions FK가 항상 비어 있음)

## 조사했으나 이슈화하지 않은 항목

- **`backend-server-foundation-spec.md` 파일 부재**: `CLAUDE.md`가 인용하는 이 파일명이 `Greyline-Project-Docs/docs/`에 실제로 존재하지 않음(해당 디렉터리에는 `backend-stack-decision-record.md`, `backend-auth-spec.md`만 있음). 코드 구현 격차가 아니라 문서 참조 오류로 판단되어 별도 이슈를 만들지 않음 — 다음에 `CLAUDE.md`를 수정할 사람이 참고할 것.
- **마켓플레이스 API**: `backend-api-implementation-spec.md`가 §1에서 명시적으로 marketplace를 스코프 밖으로 선언하고 있고, 이번 조사 지시 범위(인용된 4개 문서)에도 `marketplace-system-spec.md`가 포함되지 않아 격차로 플래그하지 않음. DB 테이블은 이미 존재하므로 추후 API 스펙이 확정되면 별도로 다뤄야 함.
  - **2026-07-17 갱신**: 이후 조사(아래 "2026-07-17 재조사" 절)에서 `marketplace-system-spec.md`와 `final-rdb-structure-with-marketplace.md`가 이미 API 스펙 수준으로 확정되어 있음을 확인, 이슈 #13·#14로 플래그함. 위 문단은 "당시 조사 범위 밖이었다"는 이력으로 남겨두고 덮어쓰지 않음.

---

## 2026-07-17 재조사 — #7·#8·#9 반영 후 현재 상태

### 확인 방법

- `git fetch origin` 후 브랜치 전환 없이 `git diff main...origin/develop --stat`, `git ls-tree -r origin/develop`로 `develop` 최신 상태 확인 (`8033480..7962f11`)
- `main`은 여전히 초기 스캐폴드 상태이며 모든 기능은 `develop`에 머지되어 있음

### 이번에 재확인한 완료 항목 (재플래그 금지, 이슈 #7·#8·#9 반영)

- 인증: `POST /api/auth/login|refresh|logout|logout-all`, `GET /api/auth/me`, `POST /api/auth/register` — `src/routes/api/auth/`
- 스태시 조회: `GET /api/stash`
- 로드아웃 조회/장착/해제: `GET /api/loadout`, `POST /api/loadout/equip`, `POST /api/loadout/unequip`
- NPC 판매: `POST /api/sell/item`, `POST /api/sell/bulk` — `src/routes/api/sell/index.ts`, `src/repositories/sell.repository.ts` (이슈 #7 CLOSED)
- 레이드 결과 제출: `POST /api/raid-results` — `src/routes/api/raid-results/index.ts`, `src/repositories/raid-result.repository.ts` (이슈 #8 CLOSED)
- `item_definitions` 시드: `migrations/0004_seed_item_definitions.sql` (이슈 #9 CLOSED)
- DB: `migrations/0002_tables.sql`에 `item_definitions.marketplace_policy` 컬럼과 `inventory_items.location_type` `marketplace_escrow` 값까지 이미 반영되어 있음 — 마켓플레이스 스키마는 완전히 구현 준비 완료 상태

### 새로 확인된 격차 (이슈 생성 완료)

#### 1. 마켓플레이스 리스팅 API 미구현 — issue #13

- `marketplace-system-spec.md` §6-13, `final-rdb-structure-with-marketplace.md` §16-18·25-26에 정의된 리스팅 등록/취소/브라우즈/셀러 조회 API가 어느 브랜치에도 없음 (`git ls-tree -r origin/develop | grep -i market` 무결과)
- `marketplace_listings` 테이블과 관련 인덱스는 이미 존재하지만 사용하는 repository/route 없음

#### 2. 마켓플레이스 구매(즉시구매) API 미구현 — issue #14

- `marketplace-system-spec.md` §14-17, `final-rdb-structure-with-marketplace.md` §19-21에 정의된 즉시구매/정산 트랜잭션이 어느 브랜치에도 없음
- `marketplace_purchases`, `marketplace_purchase_items` 테이블은 존재하지만 사용 코드 없음
- 리스팅 등록 API(issue #13)에 의존 — 순서상 #13 선행 필요

### 조사했으나 이슈화하지 않은 항목

- **크래프팅/퀘스트**: `backend-api-implementation-spec.md` §1에서 명시적으로 스코프 밖으로 선언되어 있고, `Greyline-Project-Docs/docs/` 전체에 crafting/quest 관련 스펙 문서 자체가 없음 (`grep -il craft *.md` 무결과) — 문서화된 요구사항이 없으므로 이슈화하지 않음
- **관리자(admin) 엔드포인트**: 전체 스펙 문서에 "admin" 언급 자체가 없음 — 요구사항 부재로 이슈화하지 않음
- **`characters` 테이블/API**: `final-rdb-structure-with-marketplace.md` §4에서 "Optional later"로 명시되어 MVP 범위가 아님 — 이슈화하지 않음
- **세션 목록 조회 API** (`GET /api/auth/sessions` 등): `backend-auth-spec.md` §13 Open Decisions에 세션 정리 잡(cleanup job) 필요성만 언급되어 있고 별도 엔드포인트로 명시되어 있지 않음 — 미확정 사항이라 이슈화하지 않음
- **마켓플레이스 만료(expiration) 배치/워커**: `marketplace-system-spec.md` §13이 MVP 권장 방식으로 "lazy expiration on read/mutation"을 명시하고 있어 별도 백그라운드 잡은 필수가 아님 — issue #13 인수조건에 lazy expiration 처리를 포함시켰고 워커는 후속 과제로 남김
