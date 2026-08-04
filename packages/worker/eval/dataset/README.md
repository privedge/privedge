# Independent Spanish PII eval dataset

## Qué es

Un dataset de evaluación en español, **independiente del código que evalúa**, para
medir el recall y la precisión REALES de la capa regex del detector de PII
(`packages/worker/src/pii.ts`).

Existía ya un harness en `packages/worker/eval/` (`run-eval.mjs`) que reportaba
100% de recall. Ese número no es publicable por dos razones:

1. Es autorreferencial — evalúa contra los 10 prompts de `packages/demo/src/scenarios.ts`,
   textos escritos por el propio equipo para lucir el detector en la demo.
2. El ground truth de esos prompts está incompleto — por ejemplo el caso
   `public-es` declara `expected: ['Carlos Mendoza', 'C/ Mayor 47']` pero el texto
   contiene además una referencia catastral, el código postal y el número de
   expediente. Si el detector no los caza, la métrica sigue diciendo 100% porque
   nunca se le pidió que los cazara.

Este dataset corrige ambos problemas: se generó/escribió de forma independiente
(no a partir del código de `pii.ts` ni de los prompts de la demo) y etiqueta
**todo** lo que es PII en cada documento, no solo lo que se espera que el
detector encuentre.

## Cómo se generó

Dos fuentes, combinadas por `run-dataset-eval.mjs`:

- **`generate.mjs`** (105 casos) — documentos sintéticos por plantilla, dos
  dominios (legal, sanidad), 7 tipos de documento (informe de alta, nota de
  urgencias, interconsulta, escrito de demanda, contrato, consulta a abogado,
  expediente disciplinario). Los valores (nombres, NIF/NIE, teléfonos, IBAN,
  direcciones...) salen de `pools.mjs`, con una RNG determinística
  (`makeRng`, xorshift32) sembrada con un seed fijo — la generación es
  reproducible byte a byte.
- **`adversarial.mjs`** (201 casos) — casos escritos a mano, diseñados
  deliberadamente para romper el detector. Es la parte más valiosa del
  entregable: cada caso documenta en su campo `notes` **qué** intenta romper y
  **por qué**, citando la línea o el patrón concreto de `pii.ts` que se pone a
  prueba. Ver la sección "Categorías adversariales" abajo.

No se usó ninguna librería de generación de datos (Faker, etc.) — el repo
mantiene deps mínimas a propósito. Los pools de nombres/calles/hospitales/
juzgados en `pools.mjs` están escritos a mano (40-60 valores cada uno);
la combinatoria entre pools da variedad de sobra sin necesitar una dependencia.

**Todos los datos son inventados.** Ningún nombre corresponde a una persona
real. Los NIF/NIE sintéticos usan el algoritmo de letra de control real
(`"TRWAGMYFPDXBNJZSQVHLCKE"[número % 23]`) para que sean estructuralmente
válidos, pero los números de 8 dígitos son arbitrarios, no asignaciones reales.

### Offsets, no búsqueda de substring

Cada entidad de PII en el ground truth lleva `start`/`end` (offsets de
carácter), no solo el valor. Se calculan con un `builder()` compartido
(`builder.mjs`) que acumula texto fragmento a fragmento y registra la posición
del cursor en el momento exacto en que se inserta cada valor — nunca se busca
un valor dentro del texto final (lo cual rompe en cuanto un valor se repite,
p. ej. el mismo apellido usado dos veces en un documento). Verificado: 0
discrepancias de offset en los 306 casos (`text.slice(start,end) === value`
para cada entidad).

## Categorías adversariales

`adversarial.mjs` organiza los 201 casos en 6 categorías:

| Categoría | Qué prueba | Casos |
|---|---|---|
| `indirect-reference` | PII referenciada por rol/relación ("mi representado", "el paciente de la habitación 302") — ningún regex puede alcanzar esto; solo NER/contexto | 22 |
| `malformed-format` | Formatos reales que escriben humanos: NIF con puntos, NIE en minúscula, teléfonos mal agrupados, e identificadores sectoriales (CIF, NIG, colegiado, referencia catastral) sin cobertura alguna en producción | 111 |
| `ambiguous` | Números/cadenas con forma de ID pero que NO son PII — trampa de precisión, no de recall. `entities: []` deliberadamente para el valor trampa | 20 |
| `hard-name` | Apellidos que también son palabras comunes o topónimos ("Iglesias", "Casas", "León") junto a texto que usa la misma palabra en su sentido literal | 18 |
| `noisy-context` | PII dentro de tablas, listas numeradas, saltos de línea, formato CSV, expedientes | 31 |
| `negative` | Texto sin PII pero numéricamente denso (citas legales, constantes vitales, cláusulas porcentuales) — mide falsos positivos | 16 |

Cada caso individual documenta en `notes` el razonamiento concreto: qué línea
o clase de carácter de `pii.ts` se está poniendo a prueba y por qué se espera
que falle (o no). Esa documentación se **verificó contra el runtime real**
durante el desarrollo (ver "Nota metodológica" abajo) — no son solo
suposiciones de lectura de código.

## Cómo correr

```bash
cd packages/worker/eval/dataset
node --experimental-strip-types run-dataset-eval.mjs
```

No requiere `wrangler dev` ni ningún binding — importa `detectPII`/`anonymize`
directamente de `../../src/pii.ts` con `--experimental-strip-types` (el mismo
patrón que usa `gen-sanitized.mjs`). No llama a Workers AI, no cuesta dinero.

Para regenerar solo el dataset sintético (sin correr el eval):

```bash
node generate.mjs > /tmp/cases.json
node adversarial.mjs > /tmp/adversarial-cases.json
```

## Alcance: solo la capa regex

Este runner evalúa **únicamente** `detectPII`/`anonymize` (la capa regex,
tier gratuito). La capa NER (`detectPIINER`, LLaMA vía Workers AI) requiere
`wrangler dev` con un binding `AI` real y cuesta dinero por llamada — se
evalúa por separado con el harness existente en `packages/worker/eval/`
(`run-eval.mjs` + `ner-eval-worker.ts`).

Las entidades PERSON, ORG y ADDRESS del ground truth llevan `nerScope: true`
y quedan **excluidas** del denominador de recall de este runner — no porque
no sean PII, sino porque `pii.ts` no tiene NINGÚN patrón regex para ellas
(verificado leyendo `PII_PATTERNS`: solo cubre DNI, EMAIL, SSN, PASSPORT,
IBAN, CARD, ROUTING, TAX_ID, PHONE, DATE, MRN, EMP_ID, ID). Contarlas como
"falso negativo" de un runner regex-only sería engañoso — es un dominio que
esa capa nunca pretendió cubrir. 461 entidades del dataset están en este
estado (feed pendiente para una futura pasada de eval de NER).

### Nota metodológica: cómo se mide "detectado" sin offsets del detector

`detectPII` devuelve tipos y conteos, no offsets — no se puede comparar
directamente el span que detecta contra el span del ground truth. El enfoque
elegido: correr `anonymize()` sobre el texto del caso y usar el `map` de
tokens que devuelve (`{ "[DNI_1]": "12345678Z", ... }`).

Una entidad del ground truth cuenta como **detectada** solo si algún valor
del `map` coincide **exactamente** con el valor completo de esa entidad.

Esto costó una vuelta de corrección durante el desarrollo: la primera versión
comprobaba solo si el valor ya no aparecía *literal* en el texto anonimizado
(`!anonymizedText.includes(entity.value)`). Eso es insuficiente — un patrón
más corto puede consumir una SUBCADENA de un valor más largo y dejar el resto
suelto (ejemplo real encontrado: el NIE `X 1000392 F` no matchea como NIE en
absoluto, pero el patrón PASSPORT sí captura `X 1000392` dentro de él,
dejando ` F` como texto suelto — el string completo `X 1000392 F` ya no
aparece literal, así que el chequeo ingenuo lo marcaba como "detectado"
cuando en realidad NO fue reconocido como esa entidad). El fix compara contra
el valor **exacto** y clasifica el resto como `partial` (solapamiento parcial
con un patrón no relacionado) — se sigue contando como fallo de recall, pero
se reporta aparte porque en producción ese solapamiento parcial también
implica una fuga (el fragmento no consumido queda en texto plano).
101 de los 225 falsos negativos de la corrida actual son de este tipo.

Precisión: para cada caso se comparan los valores del `map` de `anonymize()`
contra los valores del ground truth (incluyendo los marcados
`expectedMatch: false`, que documentan un valor que un patrón *distinto* al
esperado podría capturar por accidente). Un valor reemplazado que no coincide
con ninguna entidad documentada, exacta o parcialmente, es un falso positivo.

Los casos `malformed-format` con `expectedMatch: false` documentan la
predicción del autor (leyendo `pii.ts`) de que un patrón NO debería matchear.
El runner cruza esa predicción contra el resultado real (`gapDocumentationMismatches`
en el JSON) — de 201 casos adversariales solo uno tenía la documentación
equivocada (un CIF que cae por accidente en el rango del patrón PASSPORT), y
ya está corregido en el código con la explicación completa.

## Resultado — 2026-08-04

306 casos (105 sintéticos + 201 adversariales), 459 entidades en alcance
regex, 461 en alcance NER (excluidas de este run).

**Recall global: 234/459 = 51.0%.**

Desglose por tipo de entidad (recall):

| Tipo | Detectado | Esperado | Recall |
|---|---|---|---|
| DNI | 101 | 103 | 98.1% |
| PHONE | 71 | 74 | 95.9% |
| IBAN | 38 | 38 | 100% |
| CARD_HEALTH | 15 | 15 | 100% |
| CIF | 7 | 15 | 46.7% |
| NHC | 0 | 46 | **0%** |
| SSN_ES | 0 | 15 | **0%** |
| LAWYER_ID | 0 | 30 | **0%** |
| NIG | 0 | 15 | **0%** |
| CASE_ID | 0 | 15 | **0%** |
| DNI_MALFORMED | 1 | 32 | 3.1% |
| PHONE_MALFORMED | 0 | 14 | **0%** |
| CATASTRAL_UNCOVERED | 0 | 6 | **0%** |
| NIG_UNCOVERED | 0 | 6 | **0%** |
| LAWYER_ID_UNCOVERED | 0 | 6 | **0%** |
| CIF_UNCOVERED | 1 | 6 | 16.7% |

Por origen: sintético 187/315 (59.4%), adversarial 47/144 (32.6%).
Por dominio: legal 134/263 (51.0%), sanidad 100/196 (51.0%).

Precisión por tipo (de las entidades regex SÍ cubiertas): DNI 99.0%
(1 FP), PHONE 97.3% (2 FP), IBAN 97.4% (1 FP), CIF 100%, CARD_HEALTH 100%.
Falsos positivos totales: 28. Concentrados en el patrón DATE (15 FP — el
patrón `\d{1,2}/\d{1,2}/\d{2,4}` matchea fechas de trámite legítimas del
documento que el ground truth de este dataset NO marcó como PII personal;
ver nota abajo) y en colisiones PASSPORT/ID con números de serie, lotes y
referencias administrativas de 6-9 dígitos.

La salida completa (consola + JSON) se reproduce corriendo
`node --experimental-strip-types run-dataset-eval.mjs`. El JSON con
timestamp queda en este mismo directorio
(`dataset-eval-results-<fecha>.json`), con la lista completa de falsos
negativos y falsos positivos (la consola trunca a 30 líneas cada lista).

### Los hallazgos que importan

- **Identificadores sectoriales españoles: cobertura cero.** NHC (nº historia
  clínica), NIG (procedimiento judicial), número de colegiado y referencia
  catastral no tienen NINGÚN patrón en `pii.ts`. Esto no es un problema de
  formato — es que el patrón simplemente no existe. Confirma exactamente el
  hallazgo que motivó esta tarea (el caso `public-es` de `scenarios.ts` omitía
  la referencia catastral del ground truth, y aquí queda demostrado que
  además el detector no la caza).
- **CIF: sin patrón propio, "cobertura" accidental parcial.** El 46.7% de
  recall en CIF no viene de un patrón CIF — viene de que algunos CIF caen por
  casualidad dentro del patrón PASSPORT (1-3 letras + 6-9 dígitos, con lista
  de exclusión de prefijos que no incluye las letras de tipo de organización
  como B, A, P, Q, S). Se anonimizan, pero bajo el tipo equivocado
  (`PASSPORT` en vez de `CIF`) — dato relevante si alguna vez se reporta
  "qué tipo de PII se filtró", porque el reporte mentiría sobre el tipo.
- **NIF/NIE con puntos como separador de miles: 0% de recall** en los 34
  casos que usan ese formato — el separador `[-\s]?` del patrón DNI no
  incluye el punto. Es el formato que aparece en formularios en papel y
  documentos escaneados/OCR en España.
- **DNI y PHONE (los dos tipos con más volumen en el dataset) tienen recall
  >95% cuando el formato es "razonable"** — el regex core funciona bien
  dentro de su rango de formatos esperados. El problema no es "el regex está
  roto", es "el regex cubre un subconjunto más pequeño de lo que el negocio
  necesita".
- **Referencias indirectas (22 casos): 100% invisibles, por diseño.** "mi
  representado", "el paciente de la habitación 302" — cero superficie para
  cualquier regex. Esto no es una carencia de este detector en particular,
  es el límite estructural de cualquier approach basado en patrones léxicos;
  documentado para que quede claro que ese gap solo lo cierra la capa NER
  (evaluada aparte).

### Sobre la baja de 51% vs. cifras "optimistas" anteriores durante el desarrollo

Antes de aplicar la corrección metodológica descrita arriba (match exacto vs.
"ya no aparece literal"), una primera corrida reportó 73.2% de recall. Ese
número estaba inflado por solapamientos parciales — el string completo del
ground truth desaparecía del texto anonimizado aunque el detector no lo
hubiera reconocido como esa entidad, solo como fragmento de otra. El número
correcto, verificado, es 51.0%. Se documenta esta corrección explícitamente
para que quede rastro de que el dato no se ajustó a la baja por sesgo, sino
por encontrar y arreglar un bug real en el propio runner.

## Advertencia — datos sintéticos

**Este dataset es sintético e independiente del código de detección, pero NO
sustituye la validación con datos reales de cliente.** Los patrones de
lenguaje jurídico y clínico aquí son representativos pero simplificados; un
corpus real (contratos reales anonimizados, historiales clínicos reales)
tendrá variabilidad — abreviaturas, jerga, errores tipográficos genuinos,
mezcla de idiomas, formato de escaneo/OCR — que este dataset no captura por
completo. Sirve para:

- Detectar regresiones de recall/precisión en cambios al código de `pii.ts`.
- Demostrar de forma honesta y reproducible qué tipos de PII española NO
  cubre hoy la capa regex, con evidencia (no solo la afirmación).
- Dar un número de partida defendible ante un DPO técnico.

No sirve para:

- Certificar cumplimiento RGPD/HIPAA sin validación adicional sobre datos
  reales (anonimizados/sintetizados a partir de casos de cliente, bajo
  acuerdo de confidencialidad).
- Sustituir una auditoría de seguridad o un pentest de la capa de anonimización.
