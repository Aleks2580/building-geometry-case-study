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
- `src/features/massing/siteGeometry.ts` — deterministic rectangle and supplied-example input coordinates.
- `src/features/massing/ConfigurationForm.tsx` — accessible site, constraint, preference, and target inputs.
- `src/features/massing/DraftSitePreview.tsx` — immediate outline of the active site draft, with its own CSS Module.
- `src/features/massing/MassingWorkspace.tsx` — explicit preview submission and request states.
- `src/features/massing/DetailedMetrics.tsx` — site/setback, hard bounds, generated capacity, and actual metrics.
- `src/features/massing/PreferenceAssessments.tsx` — backend footprint preference and GFA target assessments.
- `src/features/massing/FeasibilitySummary.tsx` — feasibility, reason, and hard-constraint satisfaction.
- `src/features/massing/Diagnostics.tsx` — backend diagnostics and accessible detail disclosures.
- `src/features/massing/metricFormatting.ts` — display-only numeric formatting.
- `src/features/visualization/svgGeometry.ts` — pure display bounds, viewport fitting, and SVG paths.
- `src/features/visualization/SitePlan.tsx` — independent read-only SVG geometry layers and legend.
- `src/styles.css` — document defaults, base typography, design tokens, and keyboard focus styling.
- `src/vite-env.d.ts` — types the optional `VITE_API_BASE` environment variable.

Feature modules and their tests live together under `src/features/`; API
transport tests live beside the client in `src/api/`. Shared fixtures and test setup
stay in `src/test/`. Application entry points, global styles, and QueryClient setup remain
at the root. Imports use direct relative paths.

3D views, saving, branching, tree navigation, and comparison are planned separately;
see [the design note](../docs/DESIGN.md).

## Styling

Component styles live beside their owners in `.module.css` files and are imported
explicitly through scoped class names. `App.module.css` owns the page container and
header; the massing components own their form, workspace, metrics, feasibility,
and diagnostic styles. `PreferenceAssessments` uses the shared result styles directly.

`src/features/massing/massing.module.css` contains the feature's common panels,
panel headings, eyebrows, result sections, and metric rows. Reuse these classes
within the feature rather than duplicating them or adding global component selectors.
Global CSS remains limited to document defaults, typography, shared custom properties,
and accessibility defaults. No additional styling dependency is required.

The desktop workspace gives the results column more space for the plan.
Responsive rules stay with their owners: the header and workspace stack at 900 px;
page/panel padding and the form field grid adjust at 520 px. Status and validation
styles retain their existing data and accessibility attributes.

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
preview transport, integrated SVG layers, all feasibility states, request failures,
draft/result separation, out-of-order responses, cancellation, cache remounts, and
existing health behavior.
Tests use jsdom and stub the fetch boundary; no running backend is required.
Test sources are type checked.

Workspace geometry fixtures in `src/test/backendPreviewFixtures.json` capture real
backend responses, retaining configuration, geometry, and metrics together. The
tests check scalable SVG markup; actual layout and overflow need browser verification.

Focused SVG utility and component tests cover the supplied rectangle, L-shaped, and
notched sites, holes, split setback regions, missing layers, orientation, fitting,
accessibility, and deterministic rendering without input mutation.

Vite 6 and Vitest 4 share `vite.config.js`. Their minimum versions include
development-tooling security fixes. Jest DOM stays on 6.9 to retain Node 20 support.

## Configuration inputs

`ConfigurationForm` uses React Hook Form with the Zod resolver. Its typed draft is
parsed by `src/features/massing/configuration.ts`, reusing the API contracts for
numeric bounds. The **Site shape** selector offers:

- **Rectangle**: editable Width and Length in metres, initially 40 × 25 m. Positive
  finite decimal dimensions produce a closed, axis-aligned Polygon at the local
  origin. Empty, zero, negative, or invalid dimensions block submission and show
  inline errors; a previously valid rectangle is never submitted instead.
- **L-shaped example**: the supplied concave site, demonstrating setbacks around a
  reflex corner.
- **Notched example**: the supplied deep-notch site, whose setback can split or
  collapse the buildable region.
- **Custom Polygon (advanced)**: an editable GeoJSON Polygon with a closed exterior
  ring and optional closed hole rings. It starts from the current valid Polygon.
  If rectangle dimensions are invalid, it starts empty and asks for valid JSON.

The example vertices match `data/sites/` exactly, with only the first position
appended to close each ring. Small frontend coordinate constants keep the existing
Docker build context unchanged; tests compare them with the source files.
Choosing another preset intentionally replaces the active site draft; returning to
Rectangle restores 40 × 25 m. Switching shapes preserves constraints, preferences,
and the target, and never submits a preview automatically.

**Live draft site** shows a compact outline inside the site inputs, before any
submission. Its SVG is named **Draft site preview** for assistive technology. It
reads the watched RHF site through the same `siteInputSchema` used for submission
and reuses the existing SVG bounds, fitting, and path utilities. Holes remain open
through even-odd filling. Invalid dimensions or JSON/coordinate structure, and
coordinates that cannot be fitted safely, show an unavailable message instead of
retaining the last valid outline. This is unvalidated input: an outline does not
establish valid topology, buildability, or feasibility.

Only the selected site's fields are active in the form. Zod builds the request's
existing `site` Polygon from that draft; selection and dimension fields are not sent
to the API. Client checks cover JSON/coordinate structure, ring closure, numeric
inputs, and the required height-or-floor cap. Topology, capacity, preference
compatibility, and feasibility remain backend decisions.

The initial constraints are a 3 m setback, 3.5 m floor-to-floor height, and six-floor
cap; other constraints, preferences, and the target start blank. Blank optional
numbers become `null`; zero setbacks and zero GFA targets are preserved. Inline
errors are associated with their labeled inputs, and invalid submission focuses
the first error.

## Preview workflow

Choose **Generate Preview** to submit the validated draft. Editing does not send
requests or change the generated backend plan or metrics. The separate draft
outline updates immediately. A notice beside the backend result identifies
changes since the last submission, including site selection, dimension edits, and
invalid drafts. Returning to exactly the submitted draft clears the notice;
formatting-only edits also count as changes.

Each submission starts a new request, including retries with unchanged inputs.
Pending requests are cancelled when superseded or unmounted, and their results
cannot replace the active request. A new submission clears the previous backend plan,
metrics, and diagnostics while loading. Failed requests show a summary and backend
field paths/messages when available; correcting the inputs and submitting again
retries explicitly.

Successful responses show feasibility, an SVG site plan above the detailed metrics,
and grouped site/setback, capacity, actual massing, preference, and target measurements.
The prominent footprint area, floor count, height, and GFA summarize the selected
building. Theoretical hard upper
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
The frontend constructs site input coordinates only; result geometry, capacity, and
metrics come from the backend. Previews are not saved.

Feasibility shows the backend reason when supplied and hard-constraint satisfaction
as **True**, **False**, or **Unknown**. A missed GFA target does not imply a hard
constraint violation, and generation failure does not establish mathematical
infeasibility. Diagnostics show severity, code, message, and optional path verbatim.
Native **Details** disclosures expose additional backend fields, preserving primitive
values and numeric precision. An empty list displays **No diagnostics reported**.
Superseding requests and request failures remove all previous result sections.

## SVG plan renderer

`MassingWorkspace` mounts `SitePlan` directly from the successful TanStack Query
response, alongside that response's metrics and diagnostics. All four geometry
fields pass through unchanged. Empty, pending, and request-error states mount no
viewer; infeasible and generation-failed results show available site/setback context
with an explicit missing-footprint message. Draft edits retain this submitted backend
plan while the separate outline in the form reflects the current site inputs.

`SitePlan` also works independently. It needs no Query provider, API request, or
application state:

```tsx
<SitePlan
  siteGeometry={result.site_geometry}
  buildableGeometry={result.buildable_geometry}
  selectedBuildableGeometry={result.selected_buildable_geometry}
  footprintGeometry={result.footprint_geometry}
/>
```

Only `siteGeometry` is required. Geometry props reuse the existing response types;
the complete buildable region accepts Polygon or MultiPolygon, while the site,
selected component, and actual footprint accept Polygon, including interior holes.
Pass the backend's actual `footprint_geometry`. Default-generation geometry is a
separate capacity result and must never stand in for a missing selected building.

The site establishes one bounding box for every layer. The pure `geometryBounds`,
`createViewportTransform`, and `geometryPath` utilities fit that frame with uniform
scale, centered spare space, padding, and upward-positive world y coordinates.
Each ring becomes a closed subpath; even-odd fills preserve holes independently of
winding. Source vertex order and numeric precision are retained without rounding,
simplification, topology repair, component selection, area calculations, or
construction of new domain geometry.

The default logical viewport is 640 × 400 with 24 units of padding on every side.
Optional `width`, `height`, and `padding` props control the logical fit; sizes must
be finite and positive, and finite non-negative padding must leave a positive interior.
The SVG scales responsively to its container using `xMidYMid meet`. Padding scales
with the viewport; strokes retain their screen width. Fills, solid/dashed strokes,
and a visible legend distinguish the four layers. An instance-specific SVG title
and description identify displayed context and missing building geometry.

Omitted, null, or empty optional layers draw no paths. Available site/setback context
remains visible when the footprint is missing, with an explicit unavailable message.
An empty or unprojectable site frame displays an unavailable message and no paths;
it never fits an optional layer instead. These display guards do not validate
topology or determine feasibility. Pan/zoom, editing, and 3D
remain outside this component.

For browser smoke checks, run the app with its backend and select Rectangle,
L-shaped example, and Notched example in turn, submitting each explicitly.
The default rectangle and L-shaped site use a 3 m setback; the notched site at 3 m
shows two setback components. Select Custom Polygon to try the holed-site case in
`backend/tests/test_massing_preview_api.py`, using a zero setback. Check the legend,
hole openings, and selected component at desktop, tablet, 390 px, and 320 px widths.
Use a maximum height of 3 m with the floor cap blank to check infeasible context,
or a preferred footprint of `1e-30` to check generation failure with available
default capacity. A backend validation failure must remove the previous backend plan and
diagnostics; an unsubmitted edit must retain them with the changed-draft notice.

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

1. Check backend health and the default Rectangle's **Live draft site** outline
   before submitting. Generate Preview and expect a separate backend plan with
   646 m² footprint, six floors, 21 m height, and 3,876 m² GFA.
2. Edit Width and Length, including decimals, without submitting: the draft outline
   updates while the backend plan and metrics stay unchanged and the draft notice
   appears. Empty, zero, negative, and non-numeric dimensions must replace the
   draft outline with its unavailable state, show inline errors on validation, and
   block submission. Correct them and submit to update the backend result.
3. Select L-shaped example and Notched example, checking that each selection alone
   updates only the draft outline and sends no preview request. Submit each and
   check the generated backend plan matches the selected site. Enter Custom Polygon
   and verify the current coordinates are available for editing. Switch presets
   again and check unrelated constraints and preferences remain intact.
4. Try a GFA target of 1,000,000 (target unmet, hard constraints satisfied), a preferred
   footprint of 300 m² (requested/effective/actual assessment), and a setback of 100
   (infeasible, actual metrics unavailable). Inspect diagnostic codes and details.
   A preferred floor count above the cap remains a backend validation error.
5. In Custom Polygon, enter malformed JSON to check inline errors and an unavailable
   draft outline. Remove both height/floor caps to check constraint errors; a valid
   site outline must remain visible. Try zero setback/target and a valid Polygon
   with a hole, checking its opening in both views after submission.
   Enter Custom from an invalid rectangle and verify no previous Polygon or outline
   is reused. A structurally valid outline still needs backend topology validation.
6. Check desktop layout and narrow viewports at 390 px and 320 px, including the
   selector, dimension fields, draft outline and unavailable state, backend plan,
   expanded diagnostic details, inline errors, keyboard focus, and form submission.
   Request races, cancellation, network/malformed-response failures, and
   generation-failure rendering have focused automated coverage.

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
