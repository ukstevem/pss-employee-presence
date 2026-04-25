"use client";

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`platform-spinner ${className}`} />;
}

export function PageLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="platform-spinner platform-spinner-lg" />
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}
