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

## Go-to-Market

### Distribución orgánica (0-6 meses)
El developer-first GTM. Sin ventas, sin cold outreach.

1. **GitHub** — repo público, README excelente, OSS genuino
2. **Hacker News** — "Show HN: Privedge — AI inference proxy that keeps PII at the edge"
3. **ProductHunt** — launch coordinado con landing page
4. **Content** — posts técnicos: "How we built a privacy proxy for AI on Cloudflare Workers"
5. **Dev communities** — healthcare devs, fintech devs, GDPR-focused Slack/Discord

### Conversión (6-12 meses)
El developer adopta → la empresa donde trabaja necesita dashboard para auditoría → venta enterprise.

El ciclo:
```
Developer usa free → sube a Pro por el dashboard →
empresa pide audit logs para cumplimiento → Enterprise
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
