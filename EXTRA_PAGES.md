# Privedge — Extra Pages Brief

Design references and patterns for pages beyond the landing.

---

## 1. Pricing Page

**Reference**: [supabase.com/pricing](https://supabase.com/pricing)

### What we like from Supabase Pricing

- **Freemium-to-enterprise ladder** — 4 tiers con progresión clara. Free → Pro → Team → Enterprise.
- **"Start for free, scale as you grow"** — posicionamiento que elimina fricción de entrada.
- **Spend caps on by default** — mensaje de protección ANTES de hablar de escalado. Genera confianza.
- **FAQ integrado** — responde la ansiedad directamente: *"I'm worried I could end up with a huge bill."* Eliminar ese miedo en la propia página es brutal.
- **Feature comparison por dominio funcional** — no una tabla gigante, sino secciones separadas: Database, Auth, Storage, Security... El usuario va a la sección que le importa.
- **Transparencia total** — precios de add-ons visibles, sin sorpresas.

### Tiers para Privedge

| Tier | Precio | Target |
|------|--------|--------|
| **Free** | $0/mes | Developer individual, prueba |
| **Pro** | $49/mes | Startup, equipo pequeño |
| **Enterprise** | Custom | Empresa con requisitos compliance |

### Secciones de la página

```
Hero
  "Simple pricing. No surprises."
  Tagline: Start free. Pay when you scale.

Tier cards (3 columnas)
  Free / Pro / Enterprise

Feature comparison table
  Segmentada por: Detection · Routing · Analytics · Compliance · Support

FAQ
  "What counts as a request?"
  "Can I self-host for free?"
  "What happens if I exceed my limit?"
  "Do you store my prompts?"  ← crítico para compliance

CTA final
  "Still unsure? Talk to us." → calendly/email
```

### Mensaje clave a incluir

> **Spend limits are on by default.**
> We won't let you rack up a surprise bill. Set your limit once and relax.

---

## 2. Security Page

**Reference**: [supabase.com/security](https://supabase.com/security)

### What we like from Supabase Security

- **Certifications como hero visual** — SOC 2, HIPAA, ISO 27001 en grande, arriba del todo, con badge SVG. El developer enterprise lo ve en 2 segundos y sigue leyendo.
- **Terceros como validación** — mencionan Stripe, Cloudflare, GitHub. No son solo ellos diciendo que son seguros.
- **Secciones con anchor links** — navegación directa a: Auth controls → Encryption → Compliance → Incident response. Un auditor puede ir directo a lo que necesita.
- **Dashboard links para enterprise** — "Ver tu reporte en el dashboard" — convierte la página en funcional, no solo marketing.
- **Minimalismo** — sin cluttering. Whitespace generoso. Las credenciales hablan solas.

### Secciones para Privedge

```
Hero
  "Security is the product."
  Subtítulo: Every request inspected at the edge. No data stored. No exceptions.

Trust signals (badges prominentes)
  HIPAA Ready · GDPR Compliant · PCI DSS Ready · SOC2 (roadmap)

Cómo funciona técnicamente
  - PII detection en edge (nunca llega al cloud)
  - Anonimización — GPT-4 nunca ve datos reales
  - De-anonimización local — solo tú ves la respuesta completa
  - Zero storage de prompts por defecto

Secciones con anchor links
  #detection     → Cómo detectamos PII
  #routing       → Lógica de routing edge vs cloud
  #anonymization → Proceso de anonimización/de-anonimización
  #compliance    → HIPAA, GDPR, PCI — qué cubrimos y qué no
  #audit-logs    → Logs inmutables (Enterprise)
  #infrastructure → Cloudflare Workers — 200+ PoPs, no single point of failure

Transparencia (crítico)
  "We do not store your prompts."
  "We do not train models on your data."
  "You can self-host — all code is open source."

Validación de terceros
  Cloudflare Workers (infraestructura)
  Llama 3.2 (Meta — edge model)
  Referencia a Workers AI security docs

CTA enterprise
  "Need a DPA or custom compliance report? Talk to us."
```

### Mensaje clave a incluir

> **Your data never leaves the node closest to you.**
> PII is detected, anonymized, and restored — all at the edge.
> GPT-4 only sees clean prompts. Always.

---

## Notas generales de diseño

- **Dark mode first** — consistente con landing
- **Monospace para datos técnicos** — request counts, latency, model IDs
- **Verde esmeralda** (`edge`) como accent — ya establecido en la landing
- **Sin cluttering** — Supabase demuestra que menos es más en páginas de trust
- **Anchor links en Security** — facilitan uso como referencia en auditorías
- **FAQ en Pricing** — eliminar ansiedad antes de que el usuario se vaya
