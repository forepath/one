# ForePath Project Estimator Data Access

Browser-side project estimation for the ForePath landing page.

## Local model

- Runtime: [`@mlc-ai/web-llm`](https://www.npmjs.com/package/@mlc-ai/web-llm)
- Default model: `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`
- Inference runs locally via WebGPU in a **dedicated web worker** (not a service worker) so the landing page UI stays responsive.
- Worker entry: `libs/domains/forepath/frontend/feature-landingpage/src/lib/workers/forepath-local-llm.worker.ts`
- In Chrome DevTools, check **Sources → Threads** while the estimator loads; you should see a worker thread alongside Main.

## Memory guards

The estimator picks a memory profile from `navigator.deviceMemory` before loading the model:

| Profile    | Device memory        | Model        | Context window | Max output tokens |
| ---------- | -------------------- | ------------ | -------------- | ----------------- |
| `lite`     | unknown or &lt; 6 GB | Qwen2.5-0.5B | 2048           | 896               |
| `balanced` | 6–8 GB               | Qwen2.5-1.5B | 2048           | 1024              |
| `standard` | 8 GB+                | Qwen2.5-1.5B | 2048           | 1024              |

All profiles share the same post-parse calibration layer: travel is removed unless the prompt requests on-site work; missing line items are injected per detected service intent (software-development, consulting, or it-systems); billing units are aligned to shared sizing tiers using general scope signals; and it-systems emergency rate tiers are inferred from urgency language.

GPU consent and analysis-effort selection are persisted in `sessionStorage` (falling back to `localStorage`) and restored on reload. Saved analysis effort is applied only when the current device benchmark supports that profile; otherwise the autoset profile is used.

Additional safeguards:

- Reject preload/generation when Chrome reports JS heap usage above ~82% (`performance.memory`).
- Use compact service catalog and guideline prompts on `lite` and `balanced` profiles.
- Unload the worker engine on **Start over** to release GPU memory.
- The estimate page shows the loaded profile above the chat input once the model is ready. Users can switch between any profile up to the device maximum; heavier tiers above that limit stay unavailable.

If the browser still runs out of memory, the UI shows a friendly error instead of crashing the tab.

## Self-hosted model assets

Place the quantized model files under:

`apps/forepath/frontend-landingpage/public/assets/models/qwen2.5-1.5b-instruct/`

Expected tokenizer files:

- `tokenizer.json`
- `tokenizer_config.json`
- `vocab.json`
- `merges.txt`

Download the matching MLC model artifacts and serve them from the same origin as the landing page.

If the self-hosted files are not present, the app falls back to the prebuilt MLC model source for local browser inference. Inference still runs on-device via WebGPU; only the weight download location changes.

The smaller 0.5B model always uses the prebuilt MLC source.

## Device requirements

- WebGPU support
- 4 GB device memory minimum (or 4+ CPU cores when memory is unavailable)
- Modern desktop or laptop browser

If capability checks fail, the UI falls back to a contact mailto action.

## Disclaimer

Estimates are indicative only and exclude statutory VAT. Final pricing requires scope confirmation.
