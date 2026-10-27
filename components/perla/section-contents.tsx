'use client';

export function SectionContents({ items, label = 'On this page' }: { items: readonly (readonly string[])[]; label?: string }) {
  const links = items.map(([id, name]) => <a key={id} href={'#' + id} onClick={event => {
    const disclosure = event.currentTarget.closest('details');
    if (disclosure) disclosure.open = false;
  }}>{name}</a>);
  return <><nav className="pl-toc" aria-label={label}>{links}</nav><details className="pl-mobile-contents"><summary>{label}<span aria-hidden="true">+</span></summary><nav aria-label={label + ' mobile'}>{links}</nav></details></>;
}
