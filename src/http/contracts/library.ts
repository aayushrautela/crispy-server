import {
  profileIdParamsSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type LibraryProfileParams = {
  profileId: string;
};

export const profileLibraryRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
});
