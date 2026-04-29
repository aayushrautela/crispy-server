import type { AuthScope } from '../auth/auth.types.js';
import type { AiCredentialSource } from '../ai/ai.types.js';

export type ConfidentialResourceKind = 'aiConfig';
export type ConfidentialResourcePurpose = 'recommendation-generation';

export type ConfidentialResourceSelector = {
  kind: ConfidentialResourceKind;
  version: 1;
  purpose: ConfidentialResourcePurpose;
};

export type ConfidentialResourceDefinition = {
  kind: ConfidentialResourceKind;
  version: 1;
  purpose: ConfidentialResourcePurpose;
  requiredScopes: AuthScope[];
};

export type ConfidentialBundleRequest = {
  resources: ConfidentialResourceSelector[];
};

export type ConfidentialBundleContext = {
  accountId: string;
  profileId: string;
  serviceId: string;
  scopes: AuthScope[];
};

export type ConfidentialAiConfig = {
  providerId: string;
  providerType: string;
  endpointUrl: string;
  model: string;
  httpReferer: string;
  title: string;
  apiKey: string;
  credentialSource: AiCredentialSource;
};

export type ConfidentialResourceResponse = ConfidentialResourceSelector & {
  data: ConfidentialAiConfig;
  metadata: {
    cache: {
      ttlSeconds: number;
      scope: 'account-profile';
    };
    credentialSource: AiCredentialSource;
    resolvedAt: string;
  };
};

export type ConfidentialBundleResponse = {
  accountId: string;
  profileId: string;
  resources: ConfidentialResourceResponse[];
};
