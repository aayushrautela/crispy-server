import type { ProfileRecord } from './profile.repo.js';

export type ProfileView = Omit<ProfileRecord, 'profileGroupId'>;

export function mapProfileView(profile: ProfileRecord): ProfileView {
  const { profileGroupId: _profileGroupId, ...view } = profile;
  return view;
}
