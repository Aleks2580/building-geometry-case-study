# Building Geometry Case Study — Frontend

React and TypeScript frontend for exploring early-stage building massing. Users can define a site, configure building constraints, preview a generated massing, and save, branch, and compare design options.

The application provides an SVG site plan and an interactive 3D massing view. Geometry calculations, feasibility decisions, and reported metrics are produced by the backend; the frontend handles input, navigation, and visualization.

## Getting started

### Full application (recommended)

From the repository root:

```bash
docker compose up --build
```

Open <http://localhost:5173>. Docker Compose starts the frontend, FastAPI backend, and PostgreSQL, and applies backend database migrations before the API starts.

- Frontend: <http://localhost:5173>
- API documentation: <http://localhost:8000/docs>
- Backend health: <http://localhost:8000/api/v1/health>

### Frontend development

Use Node.js 20.19+, 22.13+, or a newer supported LTS release. From `frontend/`:

```bash
npm ci        # Install dependencies from package-lock.json
npm run dev   # Start the Vite development server
```

`npm ci` installs dependencies; it does not start the application. The frontend expects a running backend at `http://localhost:8000`. To use a different API address, set `VITE_API_BASE` in `frontend/.env` (see `.env.example`):

```dotenv
VITE_API_BASE=http://localhost:8000
```

For backend setup and migrations outside Docker Compose, see [Backend README](../backend/README.md).

## Main workflows

1. **Configure a site.** Choose a rectangle, L-shaped or notched example, or draw a custom polygon. Advanced GeoJSON input supports polygon holes.
2. **Set constraints.** Enter setbacks, floor-to-floor height, height and/or floor limits, and optional coverage or footprint caps. Optional preferences and a minimum GFA target support manual exploration.
3. **Generate a preview.** Submit the configuration to the backend and inspect the footprint, floor count, height, GFA, feasibility, and diagnostics. Switch between 2D and 3D without recomputing the result.
4. **Save and branch.** Save a root option, reopen saved results, and create child options with modified constraints or preferences. Previously saved options remain unchanged.
5. **Compare options.** Browse the saved decision tree, select two options, and compare their configurations, metrics, diagnostics, and geometry.

Form edits change the draft, not the last submitted result. New previews are explicit; unsaved changes never modify a persisted snapshot.

## Tech stack

| Area | Technology |
| --- | --- |
| Application | React 18, TypeScript (`strict`), Vite |
| Forms and validation | React Hook Form, Zod |
| Server state | TanStack Query |
| 2D visualization | SVG |
| 3D visualization | React Three Fiber, Three.js, Drei |
| Styling | CSS Modules |
| Testing | Vitest, React Testing Library, jsdom |

## Architecture

The frontend separates user input and interaction state from server-owned results:

- **API boundary:** `src/api/` defines the HTTP client and validates responses with Zod. TypeScript types are inferred from the frontend Zod schemas, which mirror the backend API contracts.
- **Drafts:** React Hook Form manages editable input, validation, and unsaved state.
- **Server state:** TanStack Query owns previews, saved snapshots, and comparison data. Save operations do not retry automatically because another request could create a duplicate option.
- **Visualization:** SVG and 3D consume the same backend result. Display transformations do not recalculate footprints, areas, floor counts, or feasibility.
- **Navigation:** Local React state coordinates the workspace, saved-option explorer, and comparison. No additional global state library or client-side router is needed for this prototype.

The backend remains authoritative for geometry and feasibility, while persisted options are immutable. See the [design note](../docs/DESIGN.md) for the domain model, API contracts, algorithm, and trade-offs.

## Source layout

```text
src/
├── api/                     HTTP client and Zod contracts
├── features/
│   ├── massing/
│   │   ├── configuration/   Form, validation, and configuration drafts
│   │   ├── site/            Site presets and polygon drawing
│   │   └── results/         Metrics, feasibility, and diagnostics
│   ├── options/             Save, branch, and decision-tree navigation
│   ├── comparison/          Saved-option comparison
│   └── visualization/       SVG plan and 3D massing viewer
├── test/                    Shared test fixtures and setup
├── App.tsx                  Application shell and section navigation
└── queryClient.ts           TanStack Query configuration

renderer-test/               Standalone 3D browser-verification harness
```

Tests and CSS Modules are colocated with their components where appropriate.

## Development checks

Run from `frontend/`:

```bash
npm run typecheck                 # Strict TypeScript checks
npm run lint                      # ESLint
npm run test                      # Vitest suite
npm run build                     # Typecheck and production bundle
npm run preview                   # Preview the production bundle locally
npm run typecheck:renderer-test   # Standalone renderer-harness types
npm run build:renderer-test       # Standalone renderer-harness bundle
```

The regular test suite covers forms, API contracts, preview and save flows, branching, comparison, rendering helpers, errors, and asynchronous state transitions. Tests use a mocked network boundary and do not require a running backend.

A standalone renderer harness supports browser verification of 3D geometry and WebGL behavior that jsdom cannot establish. Repository CI also runs frontend checks and a Docker Compose smoke test of the backend-backed workflow.

### Quick manual smoke test

With the full stack running:

1. Preview the default 40 × 25 m rectangle. Confirm the footprint, floors, GFA, and 2D/3D views agree.
2. Preview the L-shaped and notched sites; inspect setbacks and diagnostics.
3. Change floor or footprint preferences and confirm the backend recomputes the result only on submission.
4. Save a root option, create a branch, reload the page, and reopen both saved snapshots.
5. Compare the root and branch. Verify the original option remains unchanged and both views display the selected saved result.
6. Try invalid geometry and an infeasible setback; confirm errors or unavailable building metrics are shown without stale geometry.

## Scope and limitations

- One planar polygon site and one connected building per option; polygon holes are supported, but visual drawing edits the exterior ring only.
- Repeated floor plates represent early-stage massing, not detailed architectural design or regulatory compliance.
- The backend's deterministic construction algorithm does not guarantee a globally optimal footprint.
- Complex or oversized geometry may exceed 2D/3D rendering budgets; the viewer provides fallback states without changing backend results.
- Authentication, collaboration, automatic option suggestions, and production-scale option management are outside the prototype.

For detailed assumptions, numerical policies, persistence behavior, and future work, see [docs/DESIGN.md](../docs/DESIGN.md).
