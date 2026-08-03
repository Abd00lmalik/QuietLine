import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleAlert,
  CloudCog,
  Eye,
  LoaderCircle,
  LockKeyhole,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

export function Button({
  variant = "primary",
  icon: Icon,
  children,
  className = "",
  loading,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button button--${variant} ${className}`}
      disabled={props.disabled || loading}
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="spin" size={18} />
      ) : Icon ? (
        <Icon aria-hidden="true" size={18} />
      ) : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <button
      {...props}
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  );
}

export function Status({
  tone,
  children,
}: {
  tone: "healthy" | "warning" | "danger" | "info" | "neutral";
  children: ReactNode;
}) {
  return <span className={`status status--${tone}`}>{children}</span>;
}

export function Metric({
  label,
  value,
  detail,
  privateValue,
}: {
  label: string;
  value: string;
  detail?: string;
  privateValue?: boolean;
}) {
  return (
    <div className="metric">
      <div className="metric__label">
        {privateValue ? <LockKeyhole aria-hidden="true" size={13} /> : null}
        {label}
      </div>
      <div className="metric__value">{value}</div>
      {detail ? <div className="metric__detail">{detail}</div> : null}
    </div>
  );
}

export type PrivacyScope = "private" | "compute" | "public";

export function PrivacyLabel({
  scope,
  compact = false,
}: {
  scope: PrivacyScope;
  compact?: boolean;
}) {
  const Icon = scope === "private" ? LockKeyhole : scope === "compute" ? CloudCog : Eye;
  const label = scope === "private" ? "Private" : scope === "compute" ? "FCC computed" : "Public";
  return (
    <span className={`privacy-label privacy-label--${scope}${compact ? " privacy-label--compact" : ""}`}>
      <Icon aria-hidden="true" size={13} />
      {label}
    </span>
  );
}

export function AssetBadge({ asset }: { asset: "FXRP" | "USDT0" }) {
  return (
    <span className={`asset-badge asset-badge--${asset.toLowerCase()}`}>
      <span aria-hidden="true">{asset === "FXRP" ? "X" : "$"}</span>
      {asset}
    </span>
  );
}

export function HealthScale({
  value,
  warning = 55,
  liquidation = 65,
  label = "Loan-to-value",
}: {
  value: number;
  warning?: number;
  liquidation?: number;
  label?: string;
}) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="health-scale" aria-label={`${label}: ${value.toFixed(1)} percent`}>
      <div className="health-scale__header">
        <span>{label}</span>
        <strong>{value.toFixed(1)}%</strong>
      </div>
      <div className="health-scale__track" aria-hidden="true">
        <span className="health-scale__safe" style={{ width: `${warning}%` }} />
        <span className="health-scale__warning" style={{ left: `${warning}%`, width: `${liquidation - warning}%` }} />
        <span className="health-scale__danger" style={{ left: `${liquidation}%` }} />
        <i style={{ left: `${bounded}%` }} />
      </div>
      <div className="health-scale__legend">
        <span>Healthy</span>
        <span>Warning {warning}%</span>
        <span>Liquidation {liquidation}%</span>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon = LockKeyhole,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon aria-hidden="true" size={22} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousFocus = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", listener);
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    });
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = "";
      previousFocus?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton icon={X} label="Close dialog" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}

type Toast = {
  id: string;
  tone: "success" | "warning" | "error" | "info";
  title: string;
  body?: string;
};

const ToastContext = createContext<{
  push: (toast: Omit<Toast, "id">) => void;
}>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      4500,
    );
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => {
          const Icon =
            toast.tone === "success"
              ? Check
              : toast.tone === "warning"
                ? AlertTriangle
                : toast.tone === "error"
                  ? CircleAlert
                  : ChevronRight;
          return (
            <div key={toast.id} className={`toast toast--${toast.tone}`}>
              <Icon aria-hidden="true" size={18} />
              <div>
                <strong>{toast.title}</strong>
                {toast.body ? <p>{toast.body}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function ProgressSteps({
  steps,
  active,
}: {
  steps: string[];
  active: number;
}) {
  return (
    <ol className="progress-steps" aria-label="Operation progress">
      {steps.map((step, index) => (
        <li
          key={step}
          className={
            index < active
              ? "progress-step progress-step--complete"
              : index === active
                ? "progress-step progress-step--active"
                : "progress-step"
          }
        >
          <span>{index < active ? <Check size={14} /> : index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}
