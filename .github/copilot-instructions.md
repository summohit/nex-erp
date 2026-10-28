# Nex ERP Copilot Instructions

## Repository structure

This repository is a monorepo with three independently managed npm projects; run each project's commands from its directory.

- `backend/` is a NestJS REST API. `src/app.module.ts` composes feature modules, which generally keep controllers and services in the feature area. `PrismaService` connects to PostgreSQL through Prisma's `pg` adapter; the schema is `backend/prisma/schema.prisma`.
- `frontend/` is an Angular 21 standalone application. Feature pages are organized under `src/app/`, routes are in `src/app/app.routes.ts`, and feature services use `HttpClient` to call the API.
- `mobile/` is a React Native app that uses React Navigation and consumes the same backend API. Shared API requests go through `src/api/apiClient.ts`; session and user state live in Zustand stores.

The backend listens on port 3000 and the Angular dev server on port 4200. Angular's local API base URL is configured in `frontend/src/environments/environment.ts`. The mobile API base URL is currently hard-coded in `mobile/src/api/apiClient.ts` and points to the deployed API.

## Build, test, and lint

Run commands from the indicated project directory. There is no root package manifest.

### Backend

```sh
cd backend
npm run start:dev
npm run build
npm test -- --runInBand
npm test -- --runInBand attendance/attendance.service.spec.ts
npm run test:e2e
npm run lint
```

`npm run lint` invokes ESLint with `--fix`, so it may rewrite files.

### Frontend

```sh
cd frontend
npm start
npm run build
npm test -- --watch=false
npm test -- --include src/app/attendance-leave/attendance-leave.spec.ts --watch=false
```

The Angular test target uses Vitest; `--include` selects a test file or directory.

### Mobile

```sh
cd mobile
npm start
npm run android
npm run ios
npm test -- --runInBand
npm test -- --runInBand __tests__/apiClient.test.ts
npm run lint
```

## Architecture and conventions

- `Company` is the tenant root in the Prisma schema. For authenticated backend requests, derive tenant scope from `req.user.companyId` and pass it through to services and database queries; do not use a client-supplied company ID as the authorization boundary.
- Backend request identity distinguishes the user ID (`req.user.sub`) from the employee ID (`req.user.employeeId`). Use the ID matching the related Prisma foreign key when creating or filtering records.
- Backend controllers use `AuthGuard`; routes that require fine-grained access also use the permission decorator/guard pattern. Preserve both authentication and permission checks when adding endpoints.
- Frontend routes use lazy-loaded components and the auth/permission guards. Keep API calls in feature services; the shared auth interceptor attaches bearer tokens and handles session refresh.
- In the mobile app, use the shared Axios `apiClient` rather than creating a separate client so requests retain the configured timeout and authentication refresh behavior.
- The Angular global date-pipe display format is `dd-MM-yyyy`; keep user-facing dates consistent with it.
