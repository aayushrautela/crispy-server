import type { AuthScope } from '../auth/auth.types.js';
import type { AiCredentialSource } from '../ai/ai.types.js';
import type { AppPrincipal, AppScope } from '../apps/app-principal.types.js';

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

export type ConfidentialBundleContext =
  | {
      authType: 'service';
      accountId: string;
      profileId: string;
      scopes: AuthScope[];
      actor: { type: 'service'; serviceId: string };
    }
  | {
      authType: 'app';
      accountId: string;
      profileId: string;
      scopes: AppScope[];
      actor: { type: 'app'; principal: AppPrincipal };
    };

export type ConfidentialSecretDeliveryMode = 'proxy' | 'reference';

export type ConfidentialAiConfigProvider = {
  providerId: string;
  providerType: string;
  endpointUrl: string;
  httpReferer: string;
  title: string;
};

export type ConfidentialAiConfigModel = {
  model: string;
  contextWindow?: number;
  maxTokens?: number;
};

export type ConfidentialAiConfigRouting = {
  routeGroup: string;
  fallbackEnabled: boolean;
};

export type ConfidentialAiConfigGeneration = {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
};

export type ConfidentialAiConfigSafety = {
  contentFiltering: boolean;
  piiRedaction: boolean;
};

export type ConfidentialAiConfigSecretDelivery = {
  mode: ConfidentialSecretDeliveryMode;
  proxyEndpoint?: string;
  credentialReference?: string;
};

export type ConfidentialAiConfig = {
  provider: ConfidentialAiConfigProvider;
  model: ConfidentialAiConfigModel;
  routing: ConfidentialAiConfigRouting;
  generation: ConfidentialAiConfigGeneration;
  safety: ConfidentialAiConfigSafety;
  secretDelivery: ConfidentialAiConfigSecretDelivery;
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
