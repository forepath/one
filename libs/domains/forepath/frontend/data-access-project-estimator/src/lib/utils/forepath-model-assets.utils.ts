export const FOREPATH_LOCAL_LLM_MODEL_CONFIG_FILE = 'mlc-chat-config.json';

export async function isSelfHostedModelAvailable(modelBaseUrl: string): Promise<boolean> {
  const normalizedBaseUrl = modelBaseUrl.endsWith('/') ? modelBaseUrl : `${modelBaseUrl}/`;

  try {
    const response = await fetch(`${normalizedBaseUrl}${FOREPATH_LOCAL_LLM_MODEL_CONFIG_FILE}`);

    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('text/html')) {
      return false;
    }

    const body = await response.text();

    if (body.trimStart().startsWith('<')) {
      return false;
    }

    JSON.parse(body);

    return true;
  } catch {
    return false;
  }
}

export function isHtmlJsonParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('<!DOCTYPE') || message.includes("Unexpected token '<'") || message.includes('is not valid JSON')
  );
}

export function toModelLoadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (
    message.includes('DeviceLost') ||
    message.includes('device was lost') ||
    message.includes('out of memory') ||
    message.includes('OOM') ||
    message.includes('Failed to execute')
  ) {
    return 'The local model ran out of GPU memory. Close other tabs, reload this page, and try a shorter project description.';
  }

  if (message.includes('low on memory')) {
    return message;
  }

  if (isHtmlJsonParseError(error)) {
    return 'Local model files could not be loaded. The model may not be deployed yet on this environment.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }

  return 'Failed to load the local estimation model.';
}
