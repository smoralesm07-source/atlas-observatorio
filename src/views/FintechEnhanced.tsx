import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FintechMarketCohorts } from '../components/FintechMarketCohorts';
import { FintechEntityMarketPosition } from '../components/FintechEntityMarketPosition';
import { Fintech } from './Fintech';

type SelectedIdentity = { rut: string | null; label: string | null };

export function FintechEnhanced({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [marketHost, setMarketHost] = useState<HTMLElement | null>(null);
  const [entityHost, setEntityHost] = useState<HTMLElement | null>(null);
  const [identity, setIdentity] = useState<SelectedIdentity>({ rut: null, label: null });

  useEffect(() => {
    let marketSection: HTMLElement | null = null;
    let entityHostNode: HTMLElement | null = null;
    let explorerIndex: HTMLElement | null = null;
    let staleNote: HTMLElement | null = null;
    let oldNote: string | null = null;

    const sync = () => {
      const page = document.querySelector<HTMLElement>('.fintech-page');
      if (!page) return;

      if (!marketSection || !marketSection.isConnected) {
        const sections = Array.from(page.children).filter((node): node is HTMLElement =>
          node instanceof HTMLElement && node.classList.contains('fintech-section'),
        );
        const explorer = sections[3];
        if (explorer) {
          const section = document.createElement('section');
          section.className = 'fintech-section fintech-market-section';

          const head = document.createElement('div');
          head.className = 'fintech-section-head';
          const title = document.createElement('h2');
          const index = document.createElement('span');
          index.textContent = '4.';
          title.append(index, document.createTextNode(' Peso observable por cohortes'));
          const hint = document.createElement('p');
          hint.textContent = 'Normalizamos verticales equivalentes y comparamos únicamente métricas homogéneas dentro de cada cohorte.';
          head.append(title, hint);

          const body = document.createElement('div');
          body.className = 'fintech-market-cohort-host';
          section.append(head, body);
          explorer.before(section);
          marketSection = section;
          setMarketHost(body);

          explorerIndex = explorer.querySelector<HTMLElement>('.fintech-section-head h2 span');
          if (explorerIndex) explorerIndex.textContent = '5.';

          staleNote = page.querySelector<HTMLElement>('.fintech-context-note span');
          oldNote = staleNote?.textContent ?? null;
          if (staleNote && oldNote?.includes('201/200')) {
            staleNote.textContent = 'La referencia sectorial es agregada; ATLAS mantiene un universo individualizado y deduplicado que se actualiza desde las fuentes integradas. No se presenta una marca o producto como una nueva persona jurídica sin evidencia.';
          }
        }
      }

      if (entityHostNode && !entityHostNode.isConnected) {
        entityHostNode = null;
        setEntityHost(null);
      }

      const detailPanel = page.querySelector<HTMLElement>('.fintech-detail-panel');
      const detailGrid = detailPanel?.querySelector<HTMLElement>('.fintech-detail-grid');
      const detailHead = detailPanel?.querySelector<HTMLElement>('.fintech-detail-head');
      const label = detailHead?.querySelector<HTMLElement>('h3')?.textContent?.trim() || null;
      const context = detailHead?.querySelector<HTMLElement>('p')?.textContent?.trim() || '';
      const firstPart = context.split('·')[0]?.trim() || '';
      const rut = firstPart && !/^sin rut chileno$/i.test(firstPart) ? firstPart : null;

      if (detailGrid && detailHead) {
        if (!entityHostNode) {
          entityHostNode = document.createElement('div');
          entityHostNode.className = 'fintech-entity-market-host';
          detailGrid.after(entityHostNode);
          setEntityHost(entityHostNode);
        }
        setIdentity((current) => current.rut === rut && current.label === label ? current : { rut, label });
      } else {
        setIdentity((current) => current.rut == null && current.label == null ? current : { rut: null, label: null });
      }
    };

    const root = document.getElementById('root') ?? document.body;
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    sync();

    return () => {
      observer.disconnect();
      setMarketHost(null);
      setEntityHost(null);
      if (marketSection?.isConnected) marketSection.remove();
      if (explorerIndex) explorerIndex.textContent = '4.';
      if (staleNote && oldNote) staleNote.textContent = oldNote;
      if (entityHostNode?.isConnected) entityHostNode.remove();
    };
  }, []);

  function focusEntity(entityName: string) {
    const page = document.querySelector<HTMLElement>('.fintech-page');
    const input = page?.querySelector<HTMLInputElement>('.fintech-search input');
    if (!input) return;

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    nativeSetter?.call(input, entityName);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    page?.querySelector<HTMLElement>('.fintech-results-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return <>
    <Fintech onNavigate={onNavigate} />
    {marketHost && createPortal(<FintechMarketCohorts onSelectEntity={focusEntity} />, marketHost)}
    {entityHost && (identity.rut || identity.label) && createPortal(
      <FintechEntityMarketPosition rut={identity.rut} label={identity.label} />,
      entityHost,
    )}
  </>;
}
