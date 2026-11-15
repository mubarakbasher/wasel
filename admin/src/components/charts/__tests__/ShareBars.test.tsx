import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import ShareBars from '../ShareBars';

const plans = [
  { label: 'Starter', value: 30 },
  { label: 'Professional', value: 50 },
  { label: 'Enterprise', value: 12 },
  { label: 'Trial', value: 5 },
  { label: 'Legacy', value: 3 },
];

const sdg = (n: number) => `SDG ${n.toLocaleString('en-GB')}`;

function rowLabels(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-share-row] [data-share-label]')).map(
    (el) => el.textContent,
  );
}

function fillWidths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-share-fill]')).map(
    (el) => el.style.width,
  );
}

describe('ShareBars', () => {
  it('ShareBars: widths are proportional and the list is cut to maxItems with an "Other" row', () => {
    const { container, rerender } = render(
      <ShareBars ariaLabel="Income by plan" items={plans} maxItems={3} valueFormat={sdg} />,
    );

    // Largest first; everything past maxItems is folded into one "Other" row.
    expect(rowLabels(container)).toEqual(['Professional', 'Starter', 'Enterprise', 'Other']);
    expect(fillWidths(container)).toEqual(['50%', '30%', '12%', '8%']);
    const other = container.querySelectorAll('[data-share-row]')[3];
    expect(other).toHaveTextContent('SDG 8');
    expect(other).toHaveTextContent('8%');

    // No cut when the list fits.
    rerender(<ShareBars ariaLabel="Income by plan" items={plans} maxItems={5} valueFormat={sdg} />);
    expect(rowLabels(container)).toEqual(['Professional', 'Starter', 'Enterprise', 'Trial', 'Legacy']);
    expect(fillWidths(container)).toEqual(['50%', '30%', '12%', '5%', '3%']);
  });

  it('ShareBars: every row shows its value and share as text', () => {
    const { container } = render(
      <ShareBars ariaLabel="Income by plan" items={plans} valueFormat={sdg} />,
    );

    const first = container.querySelector('[data-share-row]')!;
    expect(first).toHaveTextContent('Professional');
    expect(first).toHaveTextContent('SDG 50');
    expect(first).toHaveTextContent('50%');
  });

  it('ShareBars: empty data shows the empty block with the same height', () => {
    const { container, rerender } = render(
      <ShareBars ariaLabel="Income by plan" items={[]} height={180} />,
    );

    const empty = container.querySelector<HTMLElement>('[data-chart-empty]')!;
    expect(empty).toHaveTextContent('No data in this period');
    expect(empty.style.height).toBe('180px');

    // Shares of nothing cannot be drawn: all-zero items are empty too, with no NaN.
    rerender(
      <ShareBars
        ariaLabel="Income by plan"
        items={[
          { label: 'Starter', value: 0 },
          { label: 'Professional', value: 0 },
        ]}
        height={180}
        emptyMessage="No income yet"
      />,
    );
    expect(screen.getByText('No income yet')).toBeInTheDocument();
    expect(container.querySelector('[data-share-row]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|undefined/);

    rerender(<ShareBars ariaLabel="Income by plan" items={plans} height={180} />);
    expect(container.querySelector('[data-chart-empty]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-chart="share"]')!.style.minHeight).toBe('180px');
  });

  it('ShareBars: exposes role="img" and a hidden data table', () => {
    const { container } = render(
      <ShareBars ariaLabel="Income by plan" items={plans} maxItems={3} valueFormat={sdg} />,
    );

    expect(screen.getByRole('img', { name: 'Income by plan' })).toBeInTheDocument();

    const table = container.querySelector('.sr-only table')!;
    expect(table).not.toBeNull();
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Professional');
    expect(rows[0]).toHaveTextContent('SDG 50');
    expect(rows[0]).toHaveTextContent('50%');
    expect(rows[3]).toHaveTextContent('Other');
  });
});
