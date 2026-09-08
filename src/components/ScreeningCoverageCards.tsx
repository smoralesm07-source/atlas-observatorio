import { useState } from 'react';
import { n } from '../lib/format';

interface CoverageCard {
  id: string;
  label: string;
  value: number;
  color: string;
  hint: string;
  description?: string;
}

export function ScreeningCoverageCards({ cards }: { cards: CoverageCard[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="coverage-cards">
      {cards.map((card) => (
        <button
          key={card.id}
          className="coverage-card"
          onClick={() => setExpanded(expanded === card.id ? null : card.id)}
          style={{ ['--card-color' as string]: card.color }}
          aria-expanded={expanded === card.id}
        >
          <div className="coverage-card-main">
            <div className="coverage-card-value num">{n(card.value)}</div>
            <div className="coverage-card-label">{card.label}</div>
          </div>

          {expanded === card.id && (
            <div className="coverage-card-details">
              <p className="coverage-card-hint">{card.hint}</p>
              {card.description && (
                <p className="coverage-card-desc">{card.description}</p>
              )}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
