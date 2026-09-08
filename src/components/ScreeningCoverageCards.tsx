import { n } from '../lib/format';

export interface ScreeningCard {
  id: string;
  title: string;
  label: string;
  value: number;
  color: string;
  subtitle: string;
}

export function ScreeningCoverageCards({
  cards,
  activeId,
  onOpen,
}: {
  cards: ScreeningCard[];
  activeId?: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="screening-cards-grid">
      {cards.map((card) => (
        <button
          key={card.id}
          className="screening-card"
          onClick={() => onOpen(card.id)}
          style={{ ['--card-color' as string]: card.color }}
          aria-expanded={activeId === card.id}
        >
          <div className="screening-card-header">
            <div className="screening-card-title">{card.title}</div>
            <div className="screening-card-value num" style={{ color: card.color }}>
              {n(card.value)}
            </div>
          </div>
          <div className="screening-card-label">{card.label}</div>
          <div className="screening-card-subtitle">{card.subtitle}</div>
        </button>
      ))}
    </div>
  );
}
