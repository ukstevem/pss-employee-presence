"use client";

import { useAuth, AuthButton } from "@platform/auth";

export default function HomePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-gray-50">
        <h1 className="text-2xl font-semibold text-gray-800">Employee Presence</h1>
        <p className="text-gray-500">Sign in to continue</p>
        <AuthButton redirectTo="/employee-presence/" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold text-gray-800">Employee Presence</h1>
      <p className="text-gray-600">Welcome, {user.email}.</p>
    </div>
  );
}
