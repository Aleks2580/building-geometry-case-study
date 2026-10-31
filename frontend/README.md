# Frontend — building geometry case study

Vite + React with strict TypeScript, a typed preview API client, and TanStack Query
for server state. The app displays backend health and a placeholder for visualization.

## Getting started

Use Node.js 20.19+, 22.13+, or a newer supported LTS release.

```bash
npm ci
npm run dev        # http://localhost:5173
```

The backend base URL defaults to `http://localhost:8000`; override with
`VITE_API_BASE` (see `.env.example`). With the root `docker compose up`, both run together.

## What's here / what's yours

- `src/api.ts` — health check and cancellable `previewMassing(request, signal?)`.
- `src/api/contracts.ts` — Zod contracts inferred as strict TypeScript types.
- `src/queryClient.ts` — reusable QueryClient factory and application instance.
- `src/App.tsx` — shows backend health + a placeholder canvas marked `TODO`.
- `src/vite-env.d.ts` — types the optional `VITE_API_BASE` environment variable.

You own the visualization: render the site, buildable footprint, massing, and
metrics, and let the user create / branch / navigate saved options (the decision
tree). Rendering approach is your call (2D SVG/canvas, 3D, …) — justify it in
`docs/DESIGN.md`. Add whatever libraries you need.

## Commands

```bash
npm run dev        # dev server
npm run typecheck  # strict TypeScript validation
npm run lint       # ESLint checks
npm run test       # run automated tests once
npm run build      # typecheck, then production build
npm run preview    # preview the build
```

ESLint uses a flat configuration with TypeScript, React Hooks, and React Refresh
rules. Generated files and dependencies are excluded.

Vitest and React Testing Library cover preview transport, the QueryClient setup,
and health loading, success, and error UI states. Tests use jsdom and stub the fetch
boundary; no running backend is required. Test sources are type checked.

Vite 6 and Vitest 4 share `vite.config.js`. Their minimum versions include
development-tooling security fixes. Jest DOM stays on 6.9 to retain Node 20 support.

## Configuration inputs

`ConfigurationForm` uses React Hook Form with the Zod resolver. Its typed string
draft is parsed by `src/configuration.ts`, reusing the API contracts for numeric
bounds. The initial example is a 40 × 25 m rectangle, a 3 m setback, 3.5 m
floor-to-floor height, and a six-floor cap. All other inputs start blank.

The JSON editor accepts a Polygon object with closed two-dimensional coordinate
rings, including holes. Client checks cover JSON/coordinate structure, numeric
inputs, and the required height-or-floor cap. Topology, capacity, preference
compatibility, and feasibility remain backend decisions. Blank optional numbers
become `null`; zero setbacks and zero GFA targets are preserved. Inline errors are
associated with their labeled inputs, and invalid submission focuses the first error.

## Massing preview API

`previewMassing` posts a `MassingPreviewRequest` to `/api/v1/massing/preview`
using `VITE_API_BASE`. Omitted optional inputs stay omitted; explicit nulls and a
zero GFA target are preserved. Pass an `AbortSignal` to cancel superseded work.

The contracts mirror `backend/app/v1/schemas/massing.py` and validate responses at
runtime. Types are inferred from these schemas rather than maintained separately.
Parsing applies the backend's optional configuration defaults and accepts additive
response fields. Polygon holes, MultiPolygon setbacks, nullable metrics, preference
results, target assessments, and all four feasibility statuses are preserved.
An `infeasible` or `generation_failed` preview is a successful domain result.

Preview failures throw `ApiError`: `kind` distinguishes `http`, `network`, and
`malformed_response`; `status` retains the HTTP status when available, and `error`
contains a validated server error code, message, and field details when supplied.
Network failures retain their `cause`. Cancellation propagates its original reason.
The existing `getHealth()` behavior and errors remain unchanged.

Geometry validity and massing rules remain server-authoritative; response validation
checks transport shapes and numeric bounds, without recalculating domain results.
JavaScript numbers use binary64 precision; integer counts outside the safe integer
range are rejected rather than silently rounded. Option API methods and preview UI
integration will be added with their consuming features.

## Server state

`main.tsx` mounts `QueryClientProvider` with the stable application `queryClient`.
`createQueryClient()` supplies the same defaults for isolated tests: queries remain
fresh for 30 seconds, inactive queries use the library's five-minute retention,
and automatic retries and window-focus refetches are disabled. Mutations explicitly
disable retries because a repeated save would create another immutable snapshot.

The health display reads Query state directly, without copying it into local state.
Its reconnect refetch is disabled to preserve the existing check-on-mount behavior.
Future forms and selection state stay local; remote preview and option results belong
in Query. Preview keys and hooks will be added with the configuration workflow so
their identity includes the actual submitted configuration.

## Docker development

From the repository root, start the complete development stack:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:5173` and verify that the page displays
`Backend health: healthy`. The backend health endpoint is
`http://localhost:8000/api/v1/health`. The frontend container runs the Vite
development server; `npm run build` produces the production bundle.
