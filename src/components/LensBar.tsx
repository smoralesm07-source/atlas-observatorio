import type { UafLens } from '../lib/contracts';

/* LA BARRA DE LENTES
   ──────────────────
   El Pulso dejó de ser una lista que se recorre a ciegas: la zona fija responde
   de qué está hecho el padrón y esta barra elige cuál de las cuatro preguntas
   siguientes se está haciendo. Sólo una lente ocupa pantalla a la vez.

   La cifra que acompaña a cada nombre no es decoración: dice qué magnitud vive
   dentro antes de entrar, para que la elección no sea a ciegas. */

export interface LensDef {
  id: UafLens;
  label: string;
  /** Magnitud que domina la lente, ya formateada. */
  badge: string;
  hint: string;
}

export function LensBar({
  lenses,
  active,
  onPick,
}: {
  lenses: LensDef[];
  active: UafLens;
  onPick: (id: UafLens) => void;
}) {
  return (
    <div className="lensbar" role="tablist" aria-label="Lentes del Pulso">
      {lenses.map((l) => (
        <button
          key={l.id}
          role="tab"
          id={`lens-tab-${l.id}`}
          aria-controls={`lens-panel-${l.id}`}
          aria-selected={l.id === active}
          title={l.hint}
          onClick={() => onPick(l.id)}
        >
          {l.label}
          <b className="num">{l.badge}</b>
        </button>
      ))}
    </div>
  );
}

export function LensPanel({
  id,
  active,
  children,
}: {
  id: UafLens;
  active: UafLens;
  children: React.ReactNode;
}) {
  if (id !== active) return null;
  return (
    <div
      className="lens fade-in"
      id={`lens-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`lens-tab-${id}`}
    >
      {children}
    </div>
  );
}
