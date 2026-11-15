import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeatGrid from '../HeatGrid';

const rowLabels = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const colLabels = Array.from({ length: 24 }, (_, h) => String(h));

/** 7 × 24 grid: every cell is 0 except the ones named here. */
function grid(values: Record<string, number> = {}): number[][] {
  return rowLabels.map((_, r) => colLabels.map((_, c) => values[`${r}:${c}`] ?? 0));
}

function cellAt(container: HTMLElement, row: number, col: number): Element {
  return container.querySelectorAll('[data-mark="cell"]')[row * 24 + col];
}

describe('HeatGrid', () => {
  it('HeatGrid: 7 × 24 cells render 168 cells; the largest value gets the strongest step', () => {
    const cells = grid({ '0:0': 1, '1:5': 40, '3:20': 100, '6:23': 60 });
    const { container } = render(
      <HeatGrid ariaLabel="Busiest hours" cells={cells} rowLabels={rowLabels} colLabels={colLabels} />,
    );

    const all = Array.from(container.querySelectorAll('[data-mark="cell"]'));
    expect(all).toHaveLength(168);

    const steps = all.map((cell) => Number(cell.getAttribute('data-step')));
    const strongest = Math.max(...steps);
    expect(strongest).toBe(5);
    // Only the peak reaches the strongest step.
    expect(steps.filter((s) => s === strongest)).toHaveLength(1);
    expect(cellAt(container, 3, 20).getAttribute('data-step')).toBe('5');
    // Smaller values sit on lower steps, in order; zero stays neutral.
    expect(cellAt(container, 6, 23).getAttribute('data-step')).toBe('3');
    expect(cellAt(container, 1, 5).getAttribute('data-step')).toBe('2');
    expect(cellAt(container, 0, 0).getAttribute('data-step')).toBe('1');
    expect(cellAt(container, 2, 2).getAttribute('data-step')).toBe('0');

    // A stronger step is drawn more opaque, on one hue.
    const opacity = (row: number, col: number) =>
      Number(cellAt(container, row, col).getAttribute('fill-opacity'));
    expect(opacity(3, 20)).toBe(1);
    expect(opacity(6, 23)).toBeLessThan(opacity(3, 20));
    expect(opacity(1, 5)).toBeLessThan(opacity(6, 23));
    expect(opacity(0, 0)).toBeLessThan(opacity(1, 5));
  });

  it('HeatGrid: focusing a cell shows its weekday, hour and value', async () => {
    const user = userEvent.setup();
    const cells = grid({ '0:0': 3, '0:1': 7, '1:1': 12 });
    const { container } = render(
      <HeatGrid
        ariaLabel="Busiest hours"
        cells={cells}
        rowLabels={rowLabels}
        colLabels={colLabels}
        valueFormat={(n) => `${n} sessions`}
      />,
    );
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();

    const hits = container.querySelectorAll<HTMLElement>('[data-chart-hit]');
    expect(hits).toHaveLength(168);
    act(() => hits[1].focus());

    let tooltip = container.querySelector('[data-chart-tooltip]')!;
    expect(tooltip).toHaveTextContent('Sat');
    expect(tooltip).toHaveTextContent('7 sessions');
    expect(hits[1]).toHaveAccessibleName('Sat, 1: 7 sessions');

    // Arrow keys move through the grid in two dimensions.
    await user.keyboard('{ArrowDown}');
    expect(hits[25]).toHaveFocus();
    tooltip = container.querySelector('[data-chart-tooltip]')!;
    expect(tooltip).toHaveTextContent('Sun');
    expect(tooltip).toHaveTextContent('12 sessions');
    expect(container.querySelectorAll('[data-chart-hit][tabindex="0"]')).toHaveLength(1);
  });

  it('HeatGrid: the active cell is ringed in dark and in white, so it shows on any shade', async () => {
    const user = userEvent.setup();
    const cells = grid({ '0:0': 1, '0:1': 100 });
    const { container } = render(
      <HeatGrid ariaLabel="Busiest hours" cells={cells} rowLabels={rowLabels} colLabels={colLabels} />,
    );
    const hits = container.querySelectorAll<HTMLElement>('[data-chart-hit]');
    const ringed = (el: HTMLElement) =>
      el.classList.contains('outline-slate-900') && el.classList.contains('inset-ring-white');

    // The strongest cell is nearly as dark as a dark ring and the lightest nearly
    // as light as a white one: the mark carries both, on hover and on focus.
    expect(ringed(hits[1])).toBe(false);
    await user.hover(hits[1]);
    expect(ringed(hits[1])).toBe(true);
    expect(ringed(hits[0])).toBe(false);
    await user.unhover(hits[1]);
    expect(ringed(hits[1])).toBe(false);

    act(() => hits[0].focus());
    expect(ringed(hits[0])).toBe(true);
    // Keyboard focus shows the same two-tone ring even while the pointer is elsewhere.
    expect(hits[0]).toHaveClass('focus-visible:outline-slate-900', 'focus-visible:inset-ring-white');
    // A blue focus ring would vanish on a blue cell.
    expect(hits[0].className).not.toMatch(/ring-blue/);
  });

  it('HeatGrid: empty data shows the empty block with the same height', () => {
    const { container, rerender } = render(
      <HeatGrid ariaLabel="Busiest hours" cells={[]} rowLabels={rowLabels} colLabels={colLabels} height={260} />,
    );

    const empty = container.querySelector<HTMLElement>('[data-chart-empty]')!;
    expect(empty).toHaveTextContent('No data in this period');
    expect(empty.style.height).toBe('260px');

    // A grid of zeros has nothing to show either, and must not divide by its peak.
    rerender(
      <HeatGrid
        ariaLabel="Busiest hours"
        cells={grid()}
        rowLabels={rowLabels}
        colLabels={colLabels}
        height={260}
        emptyMessage="No sessions yet"
      />,
    );
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(container.querySelector('[data-mark="cell"]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|undefined/);

    rerender(
      <HeatGrid
        ariaLabel="Busiest hours"
        cells={grid({ '2:9': 4 })}
        rowLabels={rowLabels}
        colLabels={colLabels}
        height={260}
      />,
    );
    expect(container.querySelector('[data-chart-empty]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-chart="heat"]')!.style.height).toBe('260px');
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('HeatGrid: exposes role="img" and a hidden data table', () => {
    const cells = grid({ '0:0': 3, '6:23': 9 });
    const { container } = render(
      <HeatGrid ariaLabel="Busiest hours" cells={cells} rowLabels={rowLabels} colLabels={colLabels} />,
    );

    expect(screen.getByRole('img', { name: 'Busiest hours' })).toBeInTheDocument();

    const table = container.querySelector('.sr-only table')!;
    expect(table).not.toBeNull();
    expect(table.querySelectorAll('thead th')).toHaveLength(24);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(7);
    expect(rows[0].querySelector('th')).toHaveTextContent('Sat');
    expect(rows[0].querySelectorAll('td')).toHaveLength(24);
    expect(rows[0].querySelectorAll('td')[0]).toHaveTextContent('3');
    expect(rows[6].querySelectorAll('td')[23]).toHaveTextContent('9');
  });
});
