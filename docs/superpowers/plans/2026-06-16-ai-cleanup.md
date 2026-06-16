# AI Text Cleanup v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local "Причесать ИИ" button that tidies a transcript (remove fillers, fix unclear spans by context, preserve speaker style) and marks every AI edit in a distinct color, revertable, with audio sync intact.

**Architecture:** Provider-agnostic AI layer in `src/main/ai/`. v1 backend = bundled `llama-server.exe` (CUDA, llama.cpp) talking over localhost, model = on-demand Qwen2.5-7B-Instruct GGUF. Cleanup runs per turn: the model returns clean prose, we compute a deterministic LCS word-diff and apply it as patches over the existing edit overlay (`src:'ai'`), so unchanged words keep their timestamps.

**Tech Stack:** Electron + TypeScript, child_process (spawn llama-server, like the existing faster-whisper engine), existing jobs queue, React renderer, existing patch/overlay model (`t0` = original).

**Spec:** `docs/superpowers/specs/2026-06-16-ai-cleanup-design.md`

---

### Task 1: De-risking spike — local model + cleanup quality (DO FIRST, gates the rest)

Goal: prove a local 7–8B model produces good Russian cleanup on a real turn BEFORE building bundle/UI. Exploratory — no production code; output is a go/no-go note.

**Files:**
- Create (throwaway): `D:\STT\input\_spike\` (scratch), delete after.
- Read: `D:\Apps\slovo-data\projects\novaya-zapis-34\engine\audio.json` (real turns + word confidence).

- [ ] **Step 1: Get a local LLM serving.** Fastest available path, in priority: (a) reuse an existing local model if present (check `ollama list`, the USB Ollama on E:, any GGUF on disk); (b) else install Ollama to D: (`OLLAMA_MODELS=D:\Apps\slovo-data\models`) and `ollama pull qwen2.5:7b-instruct`; (c) else download a single `llama-server.exe` CUDA build + a Qwen2.5-7B Q4_K_M GGUF. Record which path worked.
- [ ] **Step 2: Extract 2-3 real turns** from `novaya-zapis-34` audio.json: pick turns with low-confidence words (p<0.5). Note which words are uncertain.
- [ ] **Step 3: Build the cleanup prompt** (system: убери паразиты/повторы; сохрани стиль; неразборчивое почини по контексту; не выдумывай факты; верни только причёсанный текст) + user turn with uncertain words marked `слово?`.
- [ ] **Step 4: Run it** against the served model; capture output for each turn.
- [ ] **Step 5: Eyeball quality** and write findings to a scratch note: были ли убраны паразиты? сохранён стиль? разумно ли починены неясные места? не выдумала ли модель? Decide: model OK / try different model / prompt fixes.
- [ ] **Step 6: GO/NO-GO.** If quality is good → proceed to Task 2 with the validated model+prompt. If weak → iterate model/prompt here first. Update the spec's model choice if it changed. Clean up scratch.

**No commit** (exploration). Carry forward: chosen model id, final prompt text, server invocation.

---

### Task 2: AiProvider interface + registry + settings

**Files:**
- Create: `src/main/ai/provider.ts` (interface + registry)
- Modify: `src/main/settings.ts` (add `ai` settings), `src/shared/types.ts` (Settings.ai)

- [ ] **Step 1: Define the interface and types** in `src/main/ai/provider.ts`:

```ts
export interface CleanupOptions { systemPrompt?: string }
export interface AiProvider {
  id: 'local-llama' | 'claude'
  name: string
  isLocal: boolean
  isAvailable(): Promise<boolean>
  cleanupTurn(text: string, uncertain: string[], opts: CleanupOptions): Promise<string>
}
const providers = new Map<string, AiProvider>()
export function registerProvider(p: AiProvider): void { providers.set(p.id, p) }
export function getProvider(id: string): AiProvider | undefined { return providers.get(id) }
export function listProviders(): AiProvider[] { return [...providers.values()] }
```

- [ ] **Step 2: Add AI settings** to `src/shared/types.ts` Settings: `ai?: { provider: 'local-llama' | 'claude'; modelPath?: string; systemPrompt?: string }`, default `{ provider: 'local-llama' }`.
- [ ] **Step 3: Commit** `git commit -m "ai: provider interface + settings"`.

---

### Task 3: LCS word-diff → patches (pure, TDD — the deterministic core)

**Files:**
- Create: `src/main/ai/diff.ts`
- Test: `src/main/ai/diff.test.ts`

- [ ] **Step 1: Write failing tests** in `diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diffWords } from './diff'

describe('diffWords', () => {
  it('keeps unchanged words (same id)', () => {
    const ops = diffWords(['Меня','зовут','Матвей'], ['Меня','зовут','Матвей'])
    expect(ops.every(o => o.kind === 'keep')).toBe(true)
  })
  it('marks a replacement', () => {
    const ops = diffWords(['Меня','завут','Матвей'], ['Меня','зовут','Матвей'])
    expect(ops.find(o => o.kind === 'replace')).toMatchObject({ origIndex: 1, text: 'зовут' })
  })
  it('drops a filler (delete)', () => {
    const ops = diffWords(['ну','Меня','зовут'], ['Меня','зовут'])
    expect(ops.find(o => o.kind === 'delete')).toMatchObject({ origIndex: 0 })
  })
  it('marks an insertion', () => {
    const ops = diffWords(['Меня','Матвей'], ['Меня','зовут','Матвей'])
    expect(ops.find(o => o.kind === 'insert')).toMatchObject({ text: 'зовут' })
  })
})
```

- [ ] **Step 2: Run, verify fail.** `npx vitest run src/main/ai/diff.test.ts` → FAIL (no diffWords).
- [ ] **Step 3: Implement `diffWords`** (classic LCS over word arrays, emit keep/replace/delete/insert ops with `origIndex` referencing original word positions; adjacent delete+insert collapse to `replace`). Tokenize on whitespace; compare case-insensitively for "keep" but emit cleaned surface form.
- [ ] **Step 4: Run, verify pass.** Expected: PASS (4/4).
- [ ] **Step 5: Commit** `git commit -m "ai: LCS word-diff for cleanup patches"`.

Note: a vitest dev-dependency may need adding (`npm i -D vitest`); if the project has no test runner yet, Step 1 also adds `vitest` + a `test` script.

---

### Task 4: Word provenance `src:'ai'` + apply diff as patches

**Files:**
- Modify: `src/shared/types.ts` (Word gets `src?: 'ai'`), `src/main/ai/apply.ts` (new — turn original words + diff ops → patched words)
- Test: `src/main/ai/apply.test.ts`

- [ ] **Step 1: Failing test** — given original words `[{id:0,s,e,p,t:'ну'},{id:1,...,t:'Меня'}]` and cleaned `['Меня']`, `applyCleanup` drops id0, keeps id1 with timestamp, replacements set `t0`+`src:'ai'`, inserts get no s/e and `src:'ai'`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement `applyCleanup(words, cleanedText)`** = `diffWords(words.map(w=>w.t), tokenize(cleanedText))` then map ops → new word list (keep→unchanged; replace→`{...w, t:new, t0:w.t0??w.t, src:'ai'}`; delete→omit; insert→`{id:nextId(), t:new, src:'ai'}`).
- [ ] **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "ai: apply cleanup diff as src:'ai' patches"`.

---

### Task 5: LocalLlamaProvider (spawn llama-server, cleanupTurn)

**Files:**
- Create: `src/main/ai/localLlama.ts`, `src/main/ai/llamaServer.ts` (lifecycle)
- Modify: `src/main/paths.ts` (LLAMA_EXE, MODELS_DIR), `src/main/index.ts` (register provider on boot)

- [ ] **Step 1:** `llamaServer.ts` — lazy `ensureServer(modelPath)`: spawn bundled `llama-server.exe --model <gguf> --port <free> --n-gpu-layers <auto>` (flags finalized in Task 1), wait for `/health` ok, reuse if already running, kill on app quit. Mirror engine spawn (args array, windowsHide, no shell).
- [ ] **Step 2:** `localLlama.ts` implements `AiProvider`: `isAvailable()` = model file exists; `cleanupTurn(text, uncertain, opts)` = ensureServer → POST `/v1/chat/completions` with the validated system prompt (or `opts.systemPrompt`) + user turn (mark `uncertain` words with `?`) → return `choices[0].message.content` trimmed.
- [ ] **Step 3:** Register `LocalLlamaProvider` in `index.ts` boot.
- [ ] **Step 4: Manual check** against the Task 1 server: a tiny script calls `cleanupTurn` on a real turn, prints output.
- [ ] **Step 5: Commit** `git commit -m "ai: local llama.cpp provider (spawn + cleanupTurn)"`.

---

### Task 6: AI cleanup job (queue, per-turn, progress, revert)

**Files:**
- Create: `src/main/ai/cleanupJob.ts`
- Modify: `src/main/jobs/queue.ts` (accept an 'ai-cleanup' job kind, concurrency 1 shared with transcribe), `src/main/index.ts` (IPC `ai:cleanup`, `ai:revert`), `src/preload/index.ts`, `src/renderer/src/env.d.ts`, `src/renderer/src/api.ts`

- [ ] **Step 1:** `cleanupJob.ts` — load project turns; for each turn: collect uncertain words (p<0.5), `provider.cleanupTurn(...)`, `applyCleanup(...)`, sanity-check (skip turn if cleaned length diverges >60% or empty), accumulate; emit progress `N/M реплик`; save patched turns to project.json (preserving `t0`). Idempotent: always start from `t0`-restored originals.
- [ ] **Step 2:** Revert: `ai:revert` strips `src:'ai'` words → restore from `t0`, drop AI inserts, re-add AI-deleted originals (so keep a per-turn snapshot of pre-AI words or recompute from stored originals).
- [ ] **Step 3:** Wire IPC + preload + api + types: `startCleanup(slug)`, `revertCleanup(slug)`, progress events.
- [ ] **Step 4: Commit** `git commit -m "ai: per-turn cleanup job with progress + revert"`.

---

### Task 7: Model management — bundled engine + on-demand model download

**Files:**
- Modify: `electron-builder.yml` (extraResources: `resources/llama/`), `src/main/ai/llamaServer.ts` (resolve exe from resources), `src/main/index.ts` (IPC `ai:downloadModel` with progress, `ai:modelStatus`)
- Create: `src/main/ai/modelDownload.ts`

- [ ] **Step 1:** Bundle `llama-server.exe` + dlls under `resources/llama/` (from Task 1's working build). `extraResources` so they ship with the installer; resolve via `process.resourcesPath` when packaged, project path in dev.
- [ ] **Step 2:** `modelDownload.ts` — download the GGUF (HuggingFace URL) to `MODELS_DIR` with streamed progress + checksum; `ai:modelStatus` returns present/size; `ai:downloadModel` streams percent to renderer.
- [ ] **Step 3: Commit** `git commit -m "ai: bundle llama engine + on-demand model download"`.

---

### Task 8: Editor UI — "Причесать ИИ" button, coloring, revert

**Files:**
- Modify: `src/renderer/src/views/Editor.tsx` (button + cleanup panel + revert), `src/renderer/src/components/TranscriptView.tsx` (render `src:'ai'` words in distinct color + tooltip), `src/renderer/src/components/AiCleanupPanel.tsx` (new — progress + download-model state), CSS (ai-edit color, light+dark)

- [ ] **Step 1:** Header button "Причесать ИИ" (visible when transcript exists). If model missing → opens panel with "Скачать ИИ-модель" + download progress. If present → starts cleanup, shows progress `N/M реплик`.
- [ ] **Step 2:** Render words with `src==='ai'` in the AI color (teal/blue, distinct from amber/red confidence and from plain words); stronger shade if the original was low-confidence (repair). Tooltip "ИИ поправил · исходно: …" using `t0`.
- [ ] **Step 3:** "Отменить правки ИИ" button (calls `revertCleanup`) + ensure Ctrl+Z still works.
- [ ] **Step 4:** Privacy line in the panel: "Обработка идёт на вашем компьютере."
- [ ] **Step 5: Verify in app** (dev): download/locate model → Причесать → colored edits → tooltip → revert → export docx shows cleaned text. Screenshot.
- [ ] **Step 6: Commit** `git commit -m "ai: editor UI for cleanup (button, coloring, revert)"`.

---

## Self-Review

**Spec coverage:** providers/local backend → T2,T5,T7; cleanup-by-turn + prompt + uncertain marking → T1,T5,T6; LCS-diff + patches + timestamps kept → T3,T4; coloring + tooltip + revert → T4,T8; model download button → T7,T8; long-recording per-turn progress → T6; errors (no model, bad output, idempotent) → T6,T8; privacy line → T8. Out-of-scope (summaries/highlights/cloud/aggressiveness/custom-prompt UI) correctly absent. No gaps.

**Placeholders:** none — Task 1 is intentionally exploratory (no production code); engine flags it produces feed T5/T7 concretely.

**Type consistency:** `AiProvider.cleanupTurn(text, uncertain, opts)` used identically in T2/T5/T6; `diffWords`→`applyCleanup`→word `src:'ai'`+`t0` consistent across T3/T4/T6/T8.

**Risk note:** Task 1 may change the model (from Qwen2.5-7B) or reveal that reliable per-turn cleanup needs prompt/format tweaks; that's the point of doing it first. Tasks 5/7 finalize engine flags from Task 1.
