# NER Model Eval

Harness para comparar modelos de Workers AI en la tarea NER de producción
(`detectPIINER` en `src/pii.ts`): extraer PERSON / ORG / ADDRESS con el
`nerPrompt` real, sobre los 10 prompts del demo (5 escenarios × EN/ES) con
ground truth conocido.

## Qué mide por modelo

- **Recall** — entidades esperadas encontradas (tras el filtro verbatim de producción).
- **Paraphrased** — entidades devueltas cuyo valor NO aparece literal en el texto.
  Producción las descarta (`pii.ts` filtra con `lower.includes`), así que cada
  paráfrasis es una detección perdida, no un fallo de replace.
- **Errores** — JSON no parseable o fallo del modelo. En producción `detectPIINER`
  devuelve vacío en silencio: un error de parse = 0 detección = PII potencialmente
  filtrado a cloud. Los errores pesan como recall perdido.
- **Latencia** — media por llamada.

## Cómo correr

```bash
# Terminal 1 — worker de eval con binding AI real (requiere wrangler login)
cd packages/worker/eval
npx wrangler dev -c wrangler.toml --port 8788

# Terminal 2
node run-eval.mjs 8788
```

Modelos a comparar: editar el array `MODELS` en `run-eval.mjs`.
Coste aproximado: ~$0.006/llamada con el 70B; 10 llamadas por modelo.

## Resultados — 2026-07-08

| Modelo | Recall | Errores | Latencia media |
|---|---|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (producción) | **26/26 (100%)** | 0 | **1,404ms** |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | 23/26 (88%) | 0 | 4,383ms |
| `@cf/meta/llama-3.2-3b-instruct` | 17/26 (65% real) | 3 JSON rotos | 519ms |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 0 — `response` null 10/10 | 10 | — |
| `@cf/google/gemma-4-26b-a4b-it` | 0 — 504/undefined 10/10 | 10 | — |

Notas:
- `llama-3.1-8b-instruct` (sin fp8) deprecado por Cloudflare el 2026-05-30.
- El 8B pierde justo lo predicho: entidades cortas en ES (`Reuters`, `El País`,
  `Elena Vázquez` — tildes). Y es 3x más lento que el 70B "fast".
- El 3B rompe el JSON en 3/10 → fuga silenciosa en producción.
- qwen3/gemma-4 devuelven formatos incompatibles con el parse actual.

**Decisión: el 70B se queda.** El ahorro de coste viene de reducir llamadas
(gating por estrategia + cache negativa en `src/index.ts` / `src/pii.ts`),
no de degradar el modelo.

Re-ejecutar cuando Cloudflare publique modelos nuevos en el catálogo
(`npx wrangler ai models`).
