# Development Guide

## Coding conventions
- Prefer small, typed functions.
- Keep route handlers thin and business logic in services.
- Use tenant-aware queries consistently.
- Validate input before mutation.
- Keep response contracts explicit and consistent.

## Folder structure
- `client/src/pages`: screens
- `client/src/components`: reusable UI
- `client/src/api`: API requests
- `server/src/routes`: HTTP route handlers
- `server/src/services`: business logic
- `server/src/models`: MongoDB models
- `server/src/validators`: input validation
- `server/src/middleware`: auth and request middleware

## Local workflow
1. Configure `.env` files from examples.
2. Start MongoDB and Redis.
3. Run `npm run dev` in the server folder.
4. Run `npm run dev` in the client folder.
5. Use browser at `http://localhost:5173`.

## Testing
```bash
cd server
npm test -- --test-name-pattern='.*'
```

## Build
```bash
cd server
npm run build

cd ../client
npm run build
```

## Common issues
- `JWT_SECRET` is required.
- `GOOGLE_CLIENT_ID` is required.
- Redis or MongoDB must be running for export and metrics flows.
- CORS must include the frontend URL in production.

## Troubleshooting
- If auth fails, verify the JWT secret and Google client config.
- If export jobs hang, verify Redis connectivity and worker startup.
- If dashboard or statement behavior is wrong, confirm transaction and wallet balance data are in sync.
