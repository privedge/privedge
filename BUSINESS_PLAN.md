# Privedge — Business Plan

## Model: Open-Core + Cloud SaaS

```
OSS self-hosted (gratis, siempre)
        ↓
Cloud Free (gratis, límites generosos)
        ↓
Cloud Pro ($49/mes)
        ↓
Enterprise (custom pricing)
```

El developer adopta gratis. La empresa donde trabaja paga cuando necesita compliance.

---

## Tiers

### Free — OSS + Cloud

**Límites cloud**: 500K requests/mes

| Feature | Incluido |
|---------|----------|
| PII detection v1 (regex) | ✅ |
| Routing edge / cloud | ✅ |
| Anonimización básica (mask PII → cloud) | ✅ |
| SDK `@privedge/sdk` | ✅ |
| Self-host en tu propia cuenta Cloudflare | ✅ |
| `routed_to`, `pii_matches`, `latency_ms` en respuesta | ✅ |
| Soporte | Community (GitHub Issues) |

---

### Pro — $49/mes

**Límites cloud**: 10M requests/mes

Todo lo de Free, más:

| Feature | Incluido |
|---------|----------|
| PII detection v2 (NER model — más preciso) | ✅ |
| De-anonimización de respuesta (GPT-4 nunca ve el PII) | ✅ |
| Reglas PII personalizadas (tu propio regex / keywords) | ✅ |
| Streaming support (`stream: true`) | ✅ |
| Dashboard básico — requests, routing ratio, latencia | ✅ |
| Log retention 30 días | ✅ |
| Soporte email (48h respuesta) | ✅ |

---

### Enterprise — Custom pricing (desde ~$500/mes)

Todo lo de Pro, más:

| Feature | Incluido |
|---------|----------|
| Audit logs completos — quién pidió qué, cuándo, resultado | ✅ |
| Reportes de compliance listos para auditoría (GDPR, HIPAA, SOC2) | ✅ |
| SSO / SAML (Okta, Azure AD, Google Workspace) | ✅ |
| Data residency — garantía de región (EU only, US only) | ✅ |
| SLA 99.9% uptime | ✅ |
| Soporte dedicado + Slack privado | ✅ |
| Contratos MSA / DPA para compliance legal | ✅ |
| Onboarding personalizado | ✅ |
| Requests ilimitadas | ✅ |

---

## Economía

### Coste por request (Cloudflare Workers)
```
$0.50 / millón de requests = $0.0000005 por request
```

### Free tier — coste real por usuario activo
```
500K requests × $0.0000005 = $0.25/mes por usuario free
```
Prácticamente gratis. El free tier no es un riesgo, es marketing.

### Pro — margen
```
Ingresos:   $49/mes
Coste infra: $5/mes (10M requests × $0.50/M)
Margen:     $44/mes por cliente (~90%)
```

### Break-even
```
10 clientes Pro = $490/mes → ya cubres costes fijos básicos
50 clientes Pro = $2,450/mes → proyecto rentable
1 cliente Enterprise = $500-5,000/mes → game changer
```

---

## Roadmap de producto

### Fase 1 — MVP ✅ (completada)
- [x] Worker con PII detection (regex v1) y routing
- [x] SDK `@privedge/sdk` drop-in OpenAI
- [x] Deploy en Cloudflare Workers
- [x] Publicado en npm
- [x] `pii_matches` + `latency_ms` en respuesta

### Fase 2 — Anonimización (4-6 semanas)
*Esto convierte el producto de "mediocre con PII" a "excelente con PII"*
- [ ] Anonimización v1 — sustituir PII por tokens antes de enviar a GPT-4
- [ ] De-anonimización — restaurar PII en la respuesta antes de devolver al cliente
- [ ] Streaming support (`stream: true`)
- [ ] Reglas PII custom por usuario

### Fase 3 — Dashboard MVP (2-3 meses)
*Desbloquea el tier Pro*
- [ ] Auth — API keys por proyecto
- [ ] Dashboard — requests totales, % edge vs cloud, latencia p50/p99
- [ ] Log viewer — últimas N requests con metadata
- [ ] Alertas — picos de PII detectado

### Fase 4 — Compliance (4-6 meses)
*Desbloquea el tier Enterprise*
- [ ] PII detection v2 — NER model (Cloudflare Workers AI)
- [ ] Audit logs inmutables
- [ ] Reportes exportables (PDF) para auditorías
- [ ] Data residency por región

### Fase 5 — Enterprise (6-12 meses)
- [ ] SSO / SAML
- [ ] SOC2 Type II certificación
- [ ] Multi-cloud (AWS Lambda@Edge, Vercel Edge Functions)
- [ ] Contratos y DPA estandarizados

---

## Licencia

**MIT** — no es solo un detalle técnico, es una decisión estratégica.

En un producto de privacidad y compliance, el código cerrado genera desconfianza automática. MIT permite que cualquier empresa audite el código, lo que elimina el principal blocker en ventas enterprise: *"¿Cómo sé que realmente no estáis guardando nuestros datos?"*

La respuesta es: *"Lee el código."*

---

## Modos de uso — Los tres caminos

### 1. Self-hosted (siempre gratis)
El developer clona el repo, despliega en su propia cuenta de Cloudflare y usa el SDK apuntando a su Worker. Paga cero. Control total.

```
git clone github.com/privedge/privedge
wrangler deploy
```

### 2. Cloud hosted (Free + Pro)
El developer no toca Cloudflare. Solo se registra en `privedge.io`, obtiene una API key y cambia una línea en el SDK.

```typescript
// Antes: tu worker propio
workerUrl: 'https://mi-worker.workers.dev'

// Después: cloud de Privedge
workerUrl: 'https://api.privedge.io'
```

Privedge gestiona la infra, las actualizaciones, el escalado. El developer paga por volumen.

### 3. Híbrido — Self-host proxy + Cloud dashboard (Enterprise)
La empresa tiene requisitos de data residency — el proxy tiene que correr en su propia cuenta de Cloudflare. Pero quiere el dashboard de logs, alertas y reportes de compliance sin construirlo.

```
Su Worker (su cuenta Cloudflare) → envia metadata → Dashboard Privedge
```

Los prompts nunca salen de su infra. Solo la metadata de auditoría (timestamp, routed_to, pii_matches, latency) llega al dashboard.

---

## Go-to-Market

### Secuencia de lanzamiento (3 pasos)

**Paso 1 — OSS launch (ahora)**
SDK y proxy con licencia MIT públicos. README excelente. La comunidad empieza a usarlo y dar feedback técnico.

**Paso 2 — Cloud hosted (Fase 3)**
`privedge.io` live. Registro, API key, tier Free y Pro. El developer no tiene que configurar nada.

**Paso 3 — Enterprise dashboard (Fase 4)**
Dashboard con audit logs, compliance reports, SSO. Desbloquea el modelo híbrido y los contratos enterprise.

### Distribución orgánica (0-6 meses)
El developer-first GTM. Sin ventas, sin cold outreach.

1. **GitHub** — repo público, README excelente, OSS genuino
2. **Hacker News** — "Show HN: Privedge — AI inference proxy that keeps PII at the edge"
3. **ProductHunt** — launch coordinado con landing page
4. **Content** — posts técnicos: "How we built a privacy proxy for AI on Cloudflare Workers"
5. **Dev communities** — healthcare devs, fintech devs, GDPR-focused Slack/Discord

### Conversión (6-12 meses)
El developer adopta gratis → la empresa donde trabaja necesita compliance → venta enterprise.

```
Developer usa Free (self-hosted o cloud)
        ↓
Sube a Pro por el dashboard
        ↓
Empresa pide audit logs + data residency → Enterprise híbrido
```

### Verticales prioritarios (en orden)
1. **Salud** — HIPAA, datos de pacientes, historiales clínicos
2. **Legal** — attorney-client privilege, documentos confidenciales
3. **Fintech** — GDPR, datos bancarios, PCI DSS
4. **RRHH** — datos de empleados, procesos de selección

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Cloudflare lanza feature nativa similar | Alta | Ser OSS — la comunidad ya es nuestra |
| Calidad del edge model insuficiente | Media | Anonimización → GPT-4 resuelve esto |
| Ciclos de venta enterprise muy largos | Alta | Free tier generoso acelera adopción bottom-up |
| Competidor bien financiado (AgentCloak) | Media | Developer-first vs enterprise-first — nichos distintos |

---

## Métricas clave a trackear

```
Adoption    → GitHub stars, npm downloads/semana
Activation  → requests en 30 días tras install
Conversion  → Free → Pro (objetivo: 2-5%)
Revenue     → MRR, ARR
Retention   → churn mensual Pro (objetivo: <5%)
```

---

## Próxima decisión crítica

Antes de lanzar el dashboard necesitas elegir:

**¿Infraestructura propia o Cloudflare for Teams?**

- Propia → más control, más trabajo, más coste
- Cloudflare → menos control pero ya tienes la red, Workers KV para storage, D1 para DB

Recomendación: **Cloudflare all-in** para la v1 del dashboard. Workers + D1 + KV. Coste mínimo, cero infra que gestionar.
