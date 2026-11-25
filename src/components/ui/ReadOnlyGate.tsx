import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

const ReadOnlyContext = createContext(false);

/** Publish the server's read-only flag once per app shell. */
export function ReadOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

/**
 * Wrap only an action area: a form, a toolbar, the controls of a dialog.
 * While the server runs read-only the group becomes a disabled fieldset (its
 * buttons, inputs and selects stop responding) and carries a badge whose
 * tooltip explains why. Hovering the disabled area shows the same hint.
 * When the mode is off nothing is wrapped, so the DOM and layout are unchanged.
 */
export function ReadOnlyGate({ children, className }: { children: ReactNode; className?: string }) {
  const readOnly = useReadOnly();
  const { t } = useTranslation("shell");
  if (!readOnly) return <>{children}</>;
  return (
    <div className={`read-only-gate${className ? ` ${className}` : ""}`} title={t("readOnly.hint")}>
      <span className="read-only-badge" title={t("readOnly.hint")}>
        {t("readOnly.badge")}
      </span>
      <fieldset className="read-only-fieldset" disabled>
        {children}
      </fieldset>
    </div>
  );
}
