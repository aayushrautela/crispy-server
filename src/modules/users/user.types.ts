export type AppUser = {
  id: string;
  authSubject: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type AuthContext = {
  appUserId: string;
  authSubject: string;
  email: string | null;
};
