export function createForepathLocalLlmWorker(): Worker {
  return new Worker(new URL('./forepath-local-llm.worker', import.meta.url), { type: 'module' });
}
