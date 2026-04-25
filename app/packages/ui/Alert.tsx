"use client";

type AlertVariant = "error" | "success" | "info";

interface AlertProps {
  variant: AlertVariant;
  children: React.ReactNode;
  onDismiss?: () => void;
}

export function Alert({ variant, children, onDismiss }: AlertProps) {
  return (
    <div className={`alert alert-${variant}`}>
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-current opacity-50 hover:opacity-100 cursor-pointer text-sm"
        >
          ✕
        </button>
      )}
    </div>
  );
}
