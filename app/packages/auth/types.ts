export type UserInfo = {
  id: string;
  email: string | null;
  fullName: string | null;
};

export type ProjectRole = "none" | "member" | "manager" | "admin";
