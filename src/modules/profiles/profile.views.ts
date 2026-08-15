import type { ProfileRecord } from './profile-local.service.js';

export type ProfileView = ProfileRecord;

export function mapProfileView(profile: ProfileRecord): ProfileView {
  return profile;
}
