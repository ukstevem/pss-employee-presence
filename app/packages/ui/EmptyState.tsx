"use client";

interface EmptyStateProps {
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="text-gray-500 py-8 text-center border rounded bg-white">
      <p className="text-sm">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
