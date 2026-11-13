# 0003 — Atomic design system plus feature folders for the web app

**Status:** accepted (2026-10-29)

**Decision.** Shared UI is an atomic design system (`atoms → molecules → organisms → templates`) that never calls the
API. Business screens live in feature folders, each owning its page, components and `api.ts`. Pages are loaded on first
visit. One light theme from design tokens; one `Dialog` for every popup.

**Why.** Reuse without copy-paste, a small first load, and a change to one feature cannot break another.
