import crypto from 'node:crypto';

export interface AppCursorPayload {
  appId: string;
  kind: 'eligible_profile_changes' | 'eligible_profile_snapshot_items' | 'app_audit_events';
  sequence?: string;
  offset?: number;
  snapshotId?: string;
  issuedAt: string;
}

export interface AppCursorCodec {
  encode(payload: AppCursorPayload): string;
  decode(cursor: string): AppCursorPayload;
}

export class SignedAppCursorCodec implements AppCursorCodec {
  constructor(private readonly deps: { secret: string }) {}

  encode(payload: AppCursorPayload): string {
    const json = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', this.deps.secret);
    hmac.update(json);
    const signature = hmac.digest('base64url');
    const encoded = Buffer.from(json).toString('base64url');
    return `${encoded}.${signature}`;
  }

  decode(cursor: string): AppCursorPayload {
    const parts = cursor.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid cursor format');
    }

    const encoded = parts[0];
    const signature = parts[1];
    if (!encoded || !signature) {
      throw new Error('Invalid cursor format');
    }
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const hmac = crypto.createHmac('sha256', this.deps.secret);
    hmac.update(json);
    const expectedSignature = hmac.digest('base64url');

    if (signature !== expectedSignature) {
      throw new Error('Invalid cursor signature');
    }

    return JSON.parse(json) as AppCursorPayload;
  }
}
