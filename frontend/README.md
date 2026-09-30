# DastaVault frontend

React 19 + Vite + JavaScript/JSX. Tailwind CSS v4, shadcn/ui-style components (plain JSX in `src/components/ui`),
Motion, React Router, Redux Toolkit + RTK Query, React Hook Form + Zod, Dexie, vite-plugin-pwa.

## Run

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL, publishable key and the Worker URL
npm run dev                  # http://localhost:5173
```

## Build

```bash
npm run build                # output in dist/
npm run preview
```

## Folder map

```
src/
  components/
    ui/          shadcn-style primitives (button, dialog, sheet, select, ...)
    common/      AuthListener, ThemeManager, ProtectedRoute, ErrorBox, Logo
    layout/      AppShell, Sidebar, TopBar, BottomNav, WorkspaceSwitcher, nav.js
    people/      PersonDialog, RelationshipDialog
    groups/      GroupDialog
    settings/    GeneralPanel, TerminologyPanel, MembersPanel
  pages/         one folder per screen (Landing, Auth, Onboarding, Workspaces, Home, People, Groups, Settings, Account, Invite, ComingSoon, NotFound)
  store/         Redux store, slices (auth, ui) and RTK Query endpoint modules (workspaces, members, groups, people)
  services/      offline/db.js (Dexie); scanner, ocr, search, embedding, vault come in later phases
  hooks/         useAuth, useWorkspace (+ useTerminology), useMediaQuery
  constants/     terminology templates, roles, relations
  lib/           supabase client, cn()
  utils/         formatting helpers
  routes/        router definition
```

## Rules

- No TypeScript. Components are `.jsx`, plain modules are `.js`.
- Every label for members, people and groups comes from `useTerminology()`; never hard-code "Employee" or "Family Member".
- Only `VITE_` variables live here and all of them are public. Secrets belong to the Worker.
- Keep the app calm: animation only on landing, onboarding, workspace choice and empty states.
