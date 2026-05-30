---
project: privedge
mode: vibe
last_session: 2026-05-30
active_phase: "Phase 2 — Worker & SDK improvements"
phases_done: 1
phases_total: 4
tasks_this_session: 7
tasks_total_done: 7
velocity_last_5: [7]
blockers_count: 0
session_count: 1
---

# 📋 CONTEXT-PROGRESS
## privedge • Session #1 • 2026-05-30

```
┌─────────────────────────────────────────────────────────────────┐
│  🏗️  CURRENT PHASE: Worker & SDK improvements                   │
│  ████████████░░░░░░░  25%                                       │
│  📅 Start: 2026-05-30  •  ⏱️  Day 1                             │
│  📌 Tasks: 7/7 completed phase 1  •  🔒 0 blocked               │
└─────────────────────────────────────────────────────────────────┘
```

## Progress

| Phase | State | Start | Progress |
|-------|-------|-------|----------|
| 1. MVP — monorepo, worker, SDK, deploy | ✅ Done | 2026-05-30 | ██████████ 100% |
| 2. Worker & SDK improvements | 🔄 In progress | 2026-05-30 | ░░░░░░░░░░ 0% |
| 3. Landing page (privedge.io) | ⏳ Pending | — | ░░░░░░░░░░ 0% |
| 4. Dashboard — logs, compliance reports | ⏳ Pending | — | ░░░░░░░░░░ 0% |

## Tasks this session

### ✅ Done
- [x] Crear monorepo pnpm con packages/worker y packages/sdk
- [x] Implementar Cloudflare Worker con PII detection (regex v1) y routing edge/cloud
- [x] Deploy Worker en Cloudflare (`privedge-worker.hberdn.workers.dev`)
- [x] Implementar `@privedge/sdk` — drop-in OpenAI replacement
- [x] Publicar `@privedge/sdk@0.0.1` en npm
- [x] Validar MVP end-to-end — PII detectado, ruteado a edge, `routed_to: edge` confirmado
- [x] Crear DESIGN_BRIEF.md para Claude Design

### 🔒 Blocked
— none

### 📋 To Do

#### Worker improvements
- [ ] PII detection v2 — NER model (Cloudflare Workers AI) en vez de regex
- [ ] Soporte streaming responses (`stream: true`)
- [ ] Rate limiting por API key
- [ ] Request logging — registrar cada request con metadata (routed_to, latency, pii_detected)
- [ ] Soporte Anthropic como cloud provider (además de OpenAI)
- [ ] Soporte Gemini como cloud provider

#### SDK improvements
- [ ] Retry logic con exponential backoff
- [ ] Añadir `publishConfig.access: public` al package.json (evitar `--access public` manual)
- [ ] Soporte Anthropic en el SDK
- [ ] Soporte streaming en el SDK

#### Infraestructura
- [ ] GitHub Actions — CI para tests y deploy automático del worker
- [ ] Wrangler actualizar a v4 (actualmente en v3, hay warning)

#### Producto
- [ ] Landing page — privedge.io (ver DESIGN_BRIEF.md)
- [ ] Dashboard — routing logs y compliance reports

---

## 🔧 Tech Stack

```
Language   ▸ TypeScript
Runtime    ▸ Cloudflare Workers (edge) • Node 18+ (SDK)
Framework  ▸ —
Infra      ▸ Cloudflare Workers AI (llama-3.2-1b-instruct)
Testing    ▸ smoke.mjs (manual)
Deploy     ▸ Cloudflare Workers (worker) • npm (SDK)
```

## 📊 Metrics

```
Velocity     ▸ ⚡ 7 tasks/session (session 1)
Bugs         ▸ 🐛 0 open • ✅ 0 closed
Blockers     ▸ 🚧 0 active
```

---

## 📝 Registry

### 🐛 Bugs
| # | Date | Description | Root cause | Fix | Files |
|---|------|-------------|------------|-----|-------|

### ⚖️ Decisions
| # | Date | Decision | Rationale | Impact |
|---|------|----------|-----------|--------|
| 1 | 2026-05-30 | Cloudflare Workers en vez de Deno Deploy | Workers AI tiene modelos embebidos — sin Deno no se puede garantizar que los datos no salgan del nodo | Core del producto: datos nunca salen del edge |
| 2 | 2026-05-30 | Nombre: Privedge | Priv(acy) + edge, 2 sílabas, sin colisiones en npm/GitHub | Marca y dominio privedge.io |
| 3 | 2026-05-30 | Monorepo pnpm (worker + sdk juntos) | Cambios que afectan ambos paquetes son más fáciles de mantener y versionar | Repo único: github.com/privedge/privedge |
| 4 | 2026-05-30 | OSS el core + cloud managed de pago | Confianza: compliance + código cerrado = desconfianza. Modelo Supabase/Grafana | Distribución orgánica vía GitHub |

### 🚧 Blockers
| # | Description | Owner | Since | Notes |
|---|-------------|-------|-------|-------|

### 💡 Learnings
| # | Date | Learning |
|---|------|----------|
| 1 | 2026-05-30 | npm granular tokens necesitan "bypass 2FA" explícito para publicar — no es suficiente con desactivar 2FA en la cuenta |
| 2 | 2026-05-30 | El tarball de npm no incluye `dist/` a menos que añadas el campo `files` en package.json |
| 3 | 2026-05-30 | Cloudflare Workers AI tiene modelos embebidos en el nodo — los datos nunca salen. Deno Deploy no tiene esto, necesitaría API externa |

---

## 📅 Next Session

**Remember:**
- Worker en `privedge-worker.hberdn.workers.dev` — live y funcionando
- SDK en npm `@privedge/sdk@0.0.1` — publicado
- DESIGN_BRIEF.md listo para Claude Design (landing page)
- Wrangler v3 en uso — hay warning para actualizar a v4

**Start with:**
- ▶️ PII detection v2 — NER model en Workers AI (o streaming support)

---

## 📜 History

| Session | Date | Tasks | Phase | Summary |
|---------|------|-------|-------|---------|
| 1 | 2026-05-30 | 7 | Phase 1 — MVP | Monorepo, Worker desplegado, SDK publicado en npm, MVP validado end-to-end |
