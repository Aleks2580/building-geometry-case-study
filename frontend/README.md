# Frontend — building geometry case study

Minimal Vite + React with strict TypeScript. It boots, calls the backend health
check, and gives you an empty canvas to build the visualization in.

## Getting started

Use Node.js 20.19+, 22.13+, or a newer supported LTS release.

```bash
npm ci
npm run dev        # http://localhost:5173
```

The backend base URL defaults to `http://localhost:8000`; override with
`VITE_API_BASE` (see `.env.example`). With the root `docker compose up`, both run together.

## What's here / what's yours

- `src/api.ts` — tiny fetch client with runtime validation of the health response.
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

Vitest and React Testing Library cover the health API and its loading, success,
and error UI states. Tests use jsdom and stub only the fetch boundary; no running
backend is required. Test files and setup are included in TypeScript checks.

Vite 6 and Vitest 4 share the configuration above. Their minimum versions include
development-tooling security fixes. Jest DOM stays on 6.9 to retain Node 20 support.
