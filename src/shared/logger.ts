import pino from 'pino';
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
// Never log upstream errors, request URLs, query strings, tokens, or job payloads.
export function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z_0-9]{2,60}$/.test(error.message)
    ? error.message
    : 'OPERATION_FAILED';
}
