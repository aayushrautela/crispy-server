export type AppUser = {
  id: string;
  supabaseAuthUserId: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type AuthContext = {
  appUserId: string;
  supabaseAuthUserId: string;
  email: string | null;
};
