# CLAUDE.md — Smart O&M Frontend

## Commands

```bash
npm run dev    # Next.js dev server (Turbopack), default port 3000
npm run build  # Production build
npm run lint   # ESLint
```

Type-check manually with `npx tsc --noEmit` if needed.

## Architecture

Next.js 16 App Router project (React 19, Tailwind CSS 4, TypeScript). Language is Italian throughout the UI.

### Directory layout

- `app/` — App Router pages and layouts.
  - `page.tsx` — Home / "Admin" screen: company (azienda/site) list with search and create modal.
  - `[id]/` — Per-company pages, full-screen layout without sidebar (`layout.tsx`).
    - `page.tsx` — Redirects to `models` (flow: Admin → azienda → model gallery → dashboard).
    - `dashboard/page.tsx` — Site dashboard (KPI row, model preview with `?model=<id>` selection, Sicurezza/Ambientale panels, company-switcher drawer).
    - `models/page.tsx` — Model gallery / management (upload PLY/splat); each card opens `dashboard?model=<id>`.
    - `ply/[modelId]/page.tsx` — Full-screen PLY viewer (server component fetches model metadata, passes URL to client viewer).
    - `splat/[modelId]/page.tsx` — Gaussian Splat viewer.
    - `contacts/`, `documents/`, `photos/`, `services/`, `pois/`, `ask/` — Other site sub-pages.
- `features/models/components/` — Viewer components.
  - `plyViewer.tsx` — Main PLY 3D viewer (~2900 lines). Three.js + PLYLoader + OrbitControls + CSS2DRenderer. Handles POI markers, measurement tools (distance/area/arc), ticket management, photo gallery, category filters, WASD navigation, altitude lock. Uses `@heroicons/react` throughout.
  - `plyViewerClient.tsx` — Dynamic import wrapper (`ssr: false`).
  - `splatViewer.tsx` / `splatViewerClient.tsx` — Gaussian Splat viewer equivalents.
- `utils/dsmMeshGenerator.ts` — DSM mesh generation utility.
- `images/` — Static assets (logo SVG).
- `public/` — Public static files.

### Backend API

All API calls go to `http://localhost:4000` (configurable via `API_URL` server-side, `NEXT_PUBLIC_API_URL` client-side). In Docker the backend service is `http://backend:4000`.

Key endpoints used by the frontend:
- `GET /api/sites` — list sites
- `POST /api/sites`, `PATCH /api/sites/:id` — create/update site
- `GET /api/models/:id` — model metadata
- `GET /api/models/:id/file` — stream PLY/splat file
- `GET /api/pois?model_id=:id` — list POIs for a model
- `POST /api/pois`, `PUT /api/pois/:id`, `DELETE /api/pois/:id` — POI CRUD
- `GET /api/tickets/site/:siteId` — tickets for a site
- `POST /api/tickets`, `PUT /api/tickets/:id`, `DELETE /api/tickets/:id` — ticket CRUD
- `GET /api/photos?poi_id=:id`, `POST /api/photos` — photo management
- `GET /api/photos/stream?path=:path` — stream photo file
- `GET /api/contacts/site/:siteId` — contacts for a site

### Key conventions

- **No auth on frontend** — backend handles auth; no cookies/tokens managed client-side currently.
- **`@ts-nocheck`** is used in `plyViewer.tsx` due to Three.js typing complexity.
- **Tailwind only** — no CSS modules, no styled-components. Design uses a light Gemini/Material-inspired palette on dashboard pages, dark `#0d0f12` background for 3D viewers.
- **`@/*` path alias** maps to project root.
- **COOP/COEP headers** are set in `next.config.ts` (required for SharedArrayBuffer / Gaussian Splats).
- **`reactStrictMode: false`** — disabled to avoid double-mounting Three.js scenes.

### PLY Viewer internals (`plyViewer.tsx`)

The viewer is a single large component. Key systems:
- **Tools**: `navigate | pin | measure | area | arc` — selected via toolbar, determines click behavior on the 3D model.
- **POI system**: pins placed on the model surface, persisted to backend. Each has severity (`info/warning/critical/maintenance`), category (7 types with distinct colors), optional maintenance schedule.
- **Measurement system**: distance (2-click), area (N-click polygon), arc (3-click curve). Results shown in real-time overlay, saved to "Storico Rilievi" panel, exportable as CSV.
- **Ticket system**: tickets linked to POIs, full CRUD with inline creation, detail modal, status/priority management.
- **Photo gallery**: per-POI photo upload and viewing.
- **WASD navigation**: camera movement with configurable speed, altitude lock feature.
- **3D labels**: CSS2DRenderer for floating POI labels with severity/category-colored LED indicators.

When modifying `plyViewer.tsx`, keep the Three.js setup in the main `useEffect` (depends on `[url]`) and avoid splitting into sub-components — the tight coupling with refs/scene/raycaster makes extraction fragile.
