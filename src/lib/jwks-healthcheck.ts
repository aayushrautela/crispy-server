import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export async function assertJwksReachable(): Promise<void> {
  try {
    const response = await fetch(env.authJwksUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { keys?: unknown[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error('response contained no signing keys');
    }

    logger.info(
      { jwksUrl: env.authJwksUrl, keyCount: body.keys.length },
      'JWKS endpoint reachable and has signing keys',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.fatal(
      { jwksUrl: env.authJwksUrl, err: error },
      `JWKS endpoint unreachable: ${message}. JWT authentication will fail for all requests.`,
    );
    process.exit(1);
  }
}
