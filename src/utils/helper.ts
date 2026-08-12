export function generateActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}_${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)}`;
}
