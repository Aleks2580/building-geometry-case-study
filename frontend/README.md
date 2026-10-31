# Frontend — building geometry case study

Vite + React with strict TypeScript, a typed configuration form, and a backend massing
preview workspace. TanStack Query owns server results; React Hook Form owns drafts.

## Getting started

Use Node.js 20.19+, 22.13+, or a newer supported LTS release.

```bash
npm ci
npm run dev        # http://localhost:5173
```

The backend base URL defaults to `http://localhost:8000`; override with
`VITE_API_BASE` (see `.env.example`). With the root `docker compose up`, both run together.

## Frontend structure

- `src/api/api.ts` — health check and cancellable `previewMassing(request, signal?)`.
- `src/api/contracts.ts` — Zod contracts inferred as strict TypeScript types.
- `src/queryClient.ts` — reusable QueryClient factory and application instance.
- `src/App.tsx` — backend health and the responsive configuration workspace.
- `src/features/massing/configuration.ts` — typed draft parsing using existing Zod API contracts.
- `src/features/massing/ConfigurationForm.tsx` — accessible site, constraint, preference, and target inputs.
- `src/features/massing/MassingWorkspace.tsx` — explicit preview submission and request states.
- `src/features/massing/DetailedMetrics.tsx` — site/setback, hard bounds, generated capacity, and actual metrics.
- `src/features/massing/PreferenceAssessments.tsx` — backend footprint preference and GFA target assessments.
- `src/features/massing/FeasibilitySummary.tsx` — feasibility, reason, and hard-constraint satisfaction.
- `src/features/massing/Diagnostics.tsx` — backend diagnostics and accessible detail disclosures.
- `src/features/massing/metricFormatting.ts` — display-only numeric formatting.
- `src/styles.css` — workspace layout and basic responsive styling.
- `src/vite-env.d.ts` — types the optional `VITE_API_BASE` environment variable.

Feature modules and their tests live together under `src/features/massing/`; API
transport tests live beside the client in `src/api/`. Shared fixtures and test setup
stay in `src/test/`. Application entry points, styles, and QueryClient setup remain
at the root. Imports use direct relative paths.

SVG and 3D views, saving, branching, tree navigation,
and comparison are planned separately; see [the design note](../docs/DESIGN.md).

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

Vitest and React Testing Library cover draft parsing, accessible form validation,
preview transport, all feasibility states, request failures, draft/result separation,
out-of-order responses, cancellation, cache remounts, and existing health behavior.
Tests use jsdom and stub the fetch boundary; no running backend is required.
Test sources are type checked.

Vite 6 and Vitest 4 share `vite.config.js`. Their minimum versions include
development-tooling security fixes. Jest DOM stays on 6.9 to retain Node 20 support.

## Configuration inputs

`ConfigurationForm` uses React Hook Form with the Zod resolver. Its typed string
draft is parsed by `src/features/massing/configuration.ts`, reusing the API contracts
for numeric bounds. The initial example is a 40 × 25 m rectangle, a 3 m setback, 3.5 m
floor-to-floor height, and a six-floor cap. All other inputs start blank.

The JSON editor accepts a Polygon object with closed two-dimensional coordinate
rings, including holes. Client checks cover JSON/coordinate structure, numeric
inputs, and the required height-or-floor cap. Topology, capacity, preference
compatibility, and feasibility remain backend decisions. Blank optional numbers
become `null`; zero setbacks and zero GFA targets are preserved. Inline errors are
associated with their labeled inputs, and invalid submission focuses the first error.

## Preview workflow

Choose **Generate Preview** to submit the validated draft. Editing does not send
requests or change the displayed metrics. A notice beside the result identifies
changes since the last submission, including invalid drafts. Returning to exactly
the submitted text clears the notice; formatting-only edits also count as changes.

Each submission starts a new request, including retries with unchanged inputs.
Pending requests are cancelled when superseded or unmounted, and their results
cannot replace the active request. A new submission clears previous metrics while
loading. Failed requests show a summary and backend field paths/messages when
available; correcting the inputs and submitting again retries explicitly.

Successful responses show feasibility and grouped site/setback, capacity, actual
massing, preference, and target measurements. The prominent footprint area, floor
count, height, and GFA summarize the selected building. Theoretical hard upper
bounds do not guarantee a constructible footprint; generated default capacity
describes demonstrated construction before preferences and target-driven floor
selection. All values come directly from the response.

`feasible_target_unmet`, `infeasible`, and `generation_failed` are domain results;
they do not become HTTP errors. Null metrics display **Not available**. Numeric
display uses at most two decimal places; nonzero magnitudes below 0.01 display
**<0.01** (positive) or **>-0.01** (negative). Signed footprint differences preserve
the sign, using scientific notation below 0.01. Floor/component counts stay integers;
site coverage is a ratio with up to four decimals, using **<0.0001** for smaller
positive values. Formatting never changes response values. Missing preferences and
targets display **Not requested**, while a zero target displays **0 m²**. Null
shortfalls and undershoots stay unavailable instead of being inferred as zero.
No frontend geometry or capacity calculations are performed, and previews are not saved.

Feasibility shows the backend reason when supplied and hard-constraint satisfaction
as **True**, **False**, or **Unknown**. A missed GFA target does not imply a hard
constraint violation, and generation failure does not establish mathematical
infeasibility. Diagnostics show severity, code, message, and optional path verbatim.
Native **Details** disclosures expose additional backend fields, preserving primitive
values and numeric precision. An empty list displays **No diagnostics reported**.
Superseding requests and request failures remove all previous result sections.

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
range are rejected rather than silently rounded. Option API methods will be added
with their consuming features.

## Server state

`main.tsx` mounts `QueryClientProvider` with the stable application `queryClient`.
`createQueryClient()` supplies the same defaults for isolated tests: queries remain
fresh for 30 seconds, inactive queries use the library's five-minute retention,
and automatic retries and window-focus refetches are disabled. Mutations explicitly
disable retries because a repeated save would create another immutable snapshot.

The health display reads Query state directly, without copying it into local state.
Its reconnect refetch is disabled to preserve the existing check-on-mount behavior.
The preview key contains the parsed submitted configuration and a unique submission
ID, preventing cache reuse across explicit attempts or remounts. Query consumes the
API client's AbortSignal; results remain in Query without a local copy. Preview
queries are infinitely fresh for that attempt, with mount/reconnect refetch disabled
and network mode `always` so offline attempts surface an error. Unobserved results
use the library's five-minute retention. Submission snapshots and the draft-change
indicator are local interaction state; future option results also belong in Query.

## Browser smoke test

With the frontend and backend running:

1. Check backend health, submit the example, and expect 646 m² footprint, six floors,
   21 m height, and 3,876 m² GFA.
2. Edit a constraint without submitting: metrics stay unchanged and the draft notice
   appears beside the result. Submit to apply the change.
3. Try a GFA target of 1,000,000 (target unmet, hard constraints satisfied), a preferred
   footprint of 300 m² (requested/effective/actual assessment), and a setback of 100
   (infeasible, actual metrics unavailable). Inspect diagnostic codes and details.
   A preferred floor count above the cap remains a backend validation error.
4. Enter malformed JSON and remove both height/floor caps to check inline errors.
   Try zero setback/target and a valid Polygon with a hole.
5. Check the layout and submission on a narrow viewport. Request races, cancellation,
   network/malformed-response failures, and generation-failure rendering have focused
   automated coverage.

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
