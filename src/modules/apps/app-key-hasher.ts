import bcrypt from 'bcryptjs';

const DEFAULT_COST = 12;

export interface AppKeyHasher {
  hashSecret(secret: string): Promise<string>;
  verifySecret(input: { secret: string; expectedHash: string }): Promise<boolean>;
}

export class BcryptAppKeyHasher implements AppKeyHasher {
  constructor(private readonly cost = DEFAULT_COST) {}

  async hashSecret(secret: string): Promise<string> {
    return bcrypt.hash(secret, this.cost);
  }

  async verifySecret(input: { secret: string; expectedHash: string }): Promise<boolean> {
    return bcrypt.compare(input.secret, input.expectedHash);
  }
}
