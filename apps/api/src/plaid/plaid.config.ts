import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PlaidConfig {
  constructor(private readonly config: ConfigService) {}

  get clientId(): string {
    const v = this.config.get<string>('PLAID_CLIENT_ID');
    if (!v) throw new Error('PLAID_CLIENT_ID is required when Plaid is used');
    return v;
  }

  get secret(): string {
    const v = this.config.get<string>('PLAID_SECRET');
    if (!v) throw new Error('PLAID_SECRET is required when Plaid is used');
    return v;
  }

  get env(): 'sandbox' | 'development' | 'production' {
    const v = (this.config.get<string>('PLAID_ENV') ?? 'sandbox').toLowerCase();
    if (v !== 'sandbox' && v !== 'development' && v !== 'production') {
      throw new Error('PLAID_ENV must be sandbox, development, or production');
    }
    return v as 'sandbox' | 'development' | 'production';
  }

  get redirectUri(): string | undefined {
    return this.config.get<string>('PLAID_REDIRECT_URI');
  }

  /**
   * URL the backend should redirect to after receiving Plaid/bank OAuth callback.
   * Example: https://app.fundimo.com/plaid/continue
   */
  get oauthContinueUri(): string | undefined {
    return this.config.get<string>('PLAID_OAUTH_CONTINUE_URI');
  }

  get encryptionKey(): string {
    const v = this.config.get<string>('APP_ENCRYPTION_KEY');
    if (!v) throw new Error('APP_ENCRYPTION_KEY is required for Plaid token encryption (32 bytes base64)');
    const buf = Buffer.from(v, 'base64');
    if (buf.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to 32 bytes');
    return v;
  }
}

/** Env keys required for Plaid to be considered configured (set all or none). */
export const PLAID_REQUIRED_ENV_KEYS = ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'APP_ENCRYPTION_KEY'] as const;

/**
 * Returns which required Plaid env keys are missing. Does not validate key format (e.g. APP_ENCRYPTION_KEY 32-byte base64).
 */
export function getMissingPlaidEnvKeys(getter: (key: string) => string | undefined): string[] {
  const missing: string[] = [];
  for (const key of PLAID_REQUIRED_ENV_KEYS) {
    const v = getter(key);
    if (!v || String(v).trim() === '') missing.push(key);
  }
  return missing;
}

export function validatePlaidEnv(config?: ConfigService): void {
  const get = (key: string) => (config ? config.get<string>(key) : undefined) ?? process.env[key];
  if (get('NODE_ENV') === 'test') return;
  const missing = getMissingPlaidEnvKeys(get);
  if (missing.length === 0) return;
  const hasAny = PLAID_REQUIRED_ENV_KEYS.some((k) => get(k));
  if (hasAny && missing.length > 0) {
    throw new Error(`Plaid is partially configured. Missing: ${missing.join(', ')}. Set all or none in apps/api/.env.`);
  }
}
