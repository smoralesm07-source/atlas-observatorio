import { useState } from 'react';
import { n } from '../lib/format';

interface CoverageCard {
  id: string;
  title: string;
  label: string;
  value: number;
  color: string;
  subtitle: string;
  sections?: { heading: string; items: string[] }[];
}

export function ScreeningCoverageCards({ cards }: { cards: CoverageCard[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="screening-cards-grid">
      {cards.map((card) => (
        <button
          key={card.id}
          className="screening-card"
          onClick={() => setExpanded(expanded === card.id ? null : card.id)}
          style={{ ['--card-color' as string]: card.color }}
          aria-expanded={expanded === card.id}
        >
          <div className="screening-card-header">
            <div className="screening-card-title">{card.title}</div>
            <div className="screening-card-value num" style={{ color: card.color }}>
              {n(card.value)}
            </div>
          </div>
          <div className="screening-card-label">{card.label}</div>
          <div className="screening-card-subtitle">{card.subtitle}</div>

          {expanded === card.id && card.sections && (
            <div className="screening-card-details">
              {card.sections.map((section, idx) => (
                <div key={idx} className="screening-detail-section">
                  <h5>{section.heading}</h5>
                  <ul>
                    {section.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
