import { HttpError } from '../../lib/errors.js';

export class ConfidentialConfigError extends HttpError {
  constructor(statusCode: number, message: string) {
    super(statusCode, message);
  }
}

export class ConfidentialResourceNotFoundError extends ConfidentialConfigError {
  constructor(resource: string) {
    super(404, `Confidential resource ${resource} was not found.`);
  }
}

export class ConfidentialResourceForbiddenError extends ConfidentialConfigError {
  constructor(resource: string) {
    super(403, `Missing required scope for confidential resource ${resource}.`);
  }
}
