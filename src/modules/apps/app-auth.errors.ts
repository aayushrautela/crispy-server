export class AppAuthError extends Error {
  readonly code:
    | 'missing_app_credentials'
    | 'invalid_app_credentials'
    | 'app_disabled'
    | 'app_key_disabled'
    | 'app_key_expired'
    | 'app_scope_missing'
    | 'app_grant_missing'
    | 'app_rate_limited';

  readonly statusCode: number;

  constructor(input: {
    code: AppAuthError['code'];
    message: string;
    statusCode: number;
  }) {
    super(input.message);
    this.name = 'AppAuthError';
    this.code = input.code;
    this.statusCode = input.statusCode;
  }
}
