import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LineChart from '../LineChart';
import type { Series } from '../chartCore';

const series: Series[] = [
  { key: 'created', label: 'Created', colorClass: 'text-blue-500' },
  { key: 'used', label: 'Used', colorClass: 'text-violet-700', dashed: true },
];

const days = [
  { label: '1 Nov', values: { created: 1000, used: 600 } },
  { label: '2 Nov', values: { created: 1200, used: 800 } },
  { label: '3 Nov', values: { created: 900, used: 700 } },
];

/** Every attribute and every piece of text the chart put in the DOM. */
function domDump(container: HTMLElement): string {
  const attrs = Array.from(container.querySelectorAll('*')).flatMap((el) =>
    Array.from(el.attributes).map((a) => `${a.name}=${a.value}`),
  );
  return [...attrs, container.textContent ?? ''].join('\n');
}

function lines(container: HTMLElement): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('path[data-mark="line"]'));
}

describe('LineChart', () => {
  it('LineChart: two series render two paths and a null value breaks the line', () => {
    const points = [
      { label: '1 Nov', values: { created: 10, used: 4 } },
      { label: '2 Nov', values: { created: 12, used: 6 } },
      { label: '3 Nov', values: { created: 9, used: null } },
      { label: '4 Nov', values: { created: 14, used: 7 } },
      { label: '5 Nov', values: { created: 11, used: 8 } },
    ];
    const { container } = render(
      <LineChart ariaLabel="Cards per day" points={points} series={series} />,
    );

    const paths = lines(container);
    expect(paths).toHaveLength(2);

    const moves = (path: SVGPathElement) => (path.getAttribute('d')!.match(/M/g) ?? []).length;
    const created = container.querySelector<SVGPathElement>('path[data-mark="line"][data-series="created"]')!;
    const used = container.querySelector<SVGPathElement>('path[data-mark="line"][data-series="used"]')!;
    // One unbroken run for the full series; the null splits the other in two.
    expect(moves(created)).toBe(1);
    expect(moves(used)).toBe(2);
  });

  it('LineChart: the dashed series is drawn dashed and both are named in the legend', () => {
    const { container } = render(<LineChart ariaLabel="Cards per day" points={days} series={series} />);

    const created = container.querySelector('path[data-mark="line"][data-series="created"]')!;
    const used = container.querySelector('path[data-mark="line"][data-series="used"]')!;
    expect(created.getAttribute('stroke-dasharray')).toBeNull();
    expect(used.getAttribute('stroke-dasharray')).toBeTruthy();

    const legend = container.querySelector('[data-chart-legend]')!;
    expect(legend).toHaveTextContent('Created');
    expect(legend).toHaveTextContent('Used');
  });

  it('LineChart: focusing a column shows the tooltip with both series values', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LineChart
        ariaLabel="Cards per day"
        points={days}
        series={series}
        valueFormat={(n) => n.toLocaleString('en-GB')}
      />,
    );
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();

    const columns = container.querySelectorAll<HTMLElement>('[data-chart-hit]');
    expect(columns).toHaveLength(3);
    act(() => columns[1].focus());

    let tooltip = container.querySelector('[data-chart-tooltip]')!;
    expect(tooltip).toHaveTextContent('2 Nov');
    expect(tooltip).toHaveTextContent('Created');
    expect(tooltip).toHaveTextContent('1,200');
    expect(tooltip).toHaveTextContent('Used');
    expect(tooltip).toHaveTextContent('800');
    // The focused column says the same thing to a screen reader.
    expect(columns[1]).toHaveAccessibleName('2 Nov: Created 1,200, Used 800');

    // One tab stop for the whole chart; the arrow keys walk the columns.
    await user.keyboard('{ArrowRight}');
    expect(columns[2]).toHaveFocus();
    tooltip = container.querySelector('[data-chart-tooltip]')!;
    expect(tooltip).toHaveTextContent('3 Nov');
    expect(tooltip).toHaveTextContent('900');
    expect(tooltip).toHaveTextContent('700');
    expect(container.querySelectorAll('[data-chart-hit][tabindex="0"]')).toHaveLength(1);

    act(() => columns[2].blur());
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();
  });

  it('LineChart: empty data shows the empty block with the same height', () => {
    const { container, rerender } = render(
      <LineChart ariaLabel="Cards per day" points={[]} series={series} height={220} />,
    );

    const empty = container.querySelector<HTMLElement>('[data-chart-empty]')!;
    expect(empty).toHaveTextContent('No data in this period');
    expect(empty.style.height).toBe('220px');

    // Points whose values are all null leave nothing to draw either.
    rerender(
      <LineChart
        ariaLabel="Cards per day"
        points={[{ label: '1 Nov', values: { created: null, used: null } }]}
        series={series}
        height={220}
        emptyMessage="No cards yet"
      />,
    );
    expect(screen.getByText('No cards yet')).toBeInTheDocument();
    expect(lines(container)).toHaveLength(0);

    rerender(<LineChart ariaLabel="Cards per day" points={days} series={series} height={220} />);
    expect(container.querySelector('[data-chart-empty]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-chart="line"]')!.style.height).toBe('220px');
  });

  it('LineChart: a single point and all-zero data render without NaN in any attribute', () => {
    const { container, rerender } = render(
      <LineChart
        ariaLabel="Cards per day"
        points={[{ label: '1 Nov', values: { created: 5, used: 2 } }]}
        series={series}
      />,
    );
    expect(container.querySelector('[data-chart-empty]')).toBeNull();
    // A lone point cannot be a line segment, so it is drawn as a dot.
    expect(container.querySelectorAll('[data-mark="point"]')).toHaveLength(2);
    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined/);

    rerender(
      <LineChart
        ariaLabel="Cards per day"
        points={days.map((d) => ({ label: d.label, values: { created: 0, used: 0 } }))}
        series={series}
      />,
    );
    expect(lines(container)).toHaveLength(2);
    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('LineChart: exposes role="img" and a hidden data table', () => {
    const { container } = render(
      <LineChart
        ariaLabel="Cards per day"
        points={[...days, { label: '4 Nov', values: { created: 400, used: null } }]}
        series={series}
        valueFormat={(n) => n.toLocaleString('en-GB')}
      />,
    );

    expect(screen.getByRole('img', { name: 'Cards per day' })).toBeInTheDocument();

    const table = container.querySelector('.sr-only table')!;
    expect(table).not.toBeNull();
    const head = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(head.slice(1)).toEqual(['Created', 'Used']);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('2 Nov');
    expect(rows[1]).toHaveTextContent('1,200');
    expect(rows[1]).toHaveTextContent('800');
    expect(rows[3]).toHaveTextContent('No data');
  });
});
