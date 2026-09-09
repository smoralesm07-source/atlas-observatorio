import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FintechMarketCohorts } from '../components/FintechMarketCohorts';
import { Fintech } from './Fintech';

export function FintechEnhanced({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [marketHost, setMarketHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cleanupMounted: (() => void) | null = null;

    const mount = () => {
      if (cleanupMounted) return true;
      const page = document.querySelector<HTMLElement>('.fintech-page');
      if (!page) return false;

      const sections = Array.from(page.children).filter((node): node is HTMLElement =>
        node instanceof HTMLElement && node.classList.contains('fintech-section'),
      );
      const explorer = sections[3];
      if (!explorer) return false;

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

      const explorerIndex = explorer.querySelector<HTMLElement>('.fintech-section-head h2 span');
      if (explorerIndex) explorerIndex.textContent = '5.';

      const staleNote = page.querySelector<HTMLElement>('.fintech-context-note span');
      const oldNote = staleNote?.textContent ?? null;
      if (staleNote && oldNote?.includes('201/200')) {
        staleNote.textContent = 'La referencia sectorial es agregada; ATLAS mantiene un universo individualizado y deduplicado que se actualiza desde las fuentes integradas. No se presenta una marca o producto como una nueva persona jurídica sin evidencia.';
      }

      setMarketHost(body);
      cleanupMounted = () => {
        setMarketHost(null);
        section.remove();
        if (explorerIndex) explorerIndex.textContent = '4.';
        if (staleNote && oldNote) staleNote.textContent = oldNote;
      };
      return true;
    };

    if (mount()) return () => cleanupMounted?.();

    const observer = new MutationObserver(() => {
      if (mount()) observer.disconnect();
    });
    observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanupMounted?.();
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
  </>;
}
