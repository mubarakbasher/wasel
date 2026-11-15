import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BarChart from '../BarChart';
import type { Series } from '../chartCore';

const series: Series[] = [
  { key: 'new', label: 'New', colorClass: 'text-blue-500' },
  { key: 'renewal', label: 'Renewal', colorClass: 'text-violet-700' },
  { key: 'planChange', label: 'Plan change', colorClass: 'text-slate-500' },
];

const months = [
  { label: 'Sep 2026', values: { new: 100, renewal: 200, planChange: 50 } },
  { label: 'Oct 2026', values: { new: 150, renewal: 250, planChange: 25 } },
  { label: 'Nov 2026', values: { new: 80, renewal: 120, planChange: 10 }, muted: true },
];

const sdg = (n: number) => `SDG ${n.toLocaleString('en-GB')}`;

const rateSeries: Series[] = [{ key: 'rate', label: 'Renewal rate', colorClass: 'text-blue-500' }];
const percent = (n: number) => `${n}%`;

/** The hidden data table, as rows of cell texts. */
function tableRows(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll('.sr-only table tbody tr')).map((tr) =>
    Array.from(tr.children).map((cell) => cell.textContent ?? ''),
  );
}

/** Every attribute and every piece of text the chart put in the DOM. */
function domDump(container: HTMLElement): string {
  const attrs = Array.from(container.querySelectorAll('*')).flatMap((el) =>
    Array.from(el.attributes).map((a) => `${a.name}=${a.value}`),
  );
  return [...attrs, container.textContent ?? ''].join('\n');
}

function bars(container: HTMLElement): SVGElement[] {
  return Array.from(container.querySelectorAll<SVGElement>('[data-mark="bar"]'));
}

describe('BarChart', () => {
  it('BarChart: 3 months × 3 stacked series render 9 bar marks', () => {
    const { container } = render(
      <BarChart ariaLabel="Income per month" data={months} series={series} stacked />,
    );

    expect(bars(container)).toHaveLength(9);
    for (const s of series) {
      expect(container.querySelectorAll(`[data-mark="bar"][data-series="${s.key}"]`)).toHaveLength(3);
    }
  });

  it('BarChart: bars start at the zero baseline', () => {
    const { container } = render(
      <BarChart ariaLabel="Income per month" data={months} series={series} stacked />,
    );

    const svg = container.querySelector('svg[role="img"]')!;
    const plotHeight = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    // The first series is the bottom segment of every stack: its path starts on
    // the baseline (the bottom edge of the plot), never above it.
    const bottoms = Array.from(container.querySelectorAll('[data-mark="bar"][data-series="new"]'));
    expect(bottoms).toHaveLength(3);
    for (const bar of bottoms) {
      const start = /^M([\d.]+) ([\d.]+)/.exec(bar.getAttribute('d')!)!;
      expect(Number(start[2])).toBe(plotHeight);
    }
  });

  it('BarChart: unstacked series render one bar per series side by side', () => {
    const { container } = render(
      <BarChart ariaLabel="Income per month" data={months} series={series} />,
    );

    const firstMonth = Array.from(container.querySelectorAll('[data-mark="bar"][data-index="0"]'));
    expect(firstMonth).toHaveLength(3);
    const xs = firstMonth.map((bar) => Number(/^M([\d.]+) /.exec(bar.getAttribute('d')!)![1]));
    expect(new Set(xs).size).toBe(3);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('BarChart: a muted bar carries the lighter class', () => {
    const { container } = render(
      <BarChart ariaLabel="Income per month" data={months} series={series} stacked />,
    );

    const muted = Array.from(container.querySelectorAll('[data-mark="bar"][data-index="2"]'));
    const solid = Array.from(container.querySelectorAll('[data-mark="bar"]:not([data-index="2"])'));
    expect(muted).toHaveLength(3);
    expect(solid).toHaveLength(6);
    for (const bar of muted) expect(bar).toHaveClass('opacity-40');
    for (const bar of solid) expect(bar).not.toHaveClass('opacity-40');
  });

  it('BarChart: empty data shows the empty block with the same height', () => {
    const { container, rerender } = render(
      <BarChart ariaLabel="Income per month" data={[]} series={series} height={200} />,
    );

    const empty = container.querySelector<HTMLElement>('[data-chart-empty]')!;
    expect(empty).toHaveTextContent('No data in this period');
    expect(empty.style.height).toBe('200px');
    expect(container.querySelector('[data-mark="bar"]')).toBeNull();

    rerender(
      <BarChart
        ariaLabel="Income per month"
        data={[]}
        series={series}
        height={200}
        emptyMessage="No income yet"
      />,
    );
    expect(screen.getByText('No income yet')).toBeInTheDocument();

    rerender(<BarChart ariaLabel="Income per month" data={months} series={series} height={200} />);
    expect(container.querySelector('[data-chart-empty]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-chart="bar"]')!.style.height).toBe('200px');
  });

  it('BarChart: all-zero data renders without NaN in any attribute', () => {
    const zeros = months.map((m) => ({ label: m.label, values: { new: 0, renewal: 0, planChange: 0 } }));
    const { container } = render(
      <BarChart ariaLabel="Income per month" data={zeros} series={series} stacked valueFormat={sdg} />,
    );

    // Zero is data, not "no data": the axes are drawn, the bars are not.
    expect(container.querySelector('[data-chart-empty]')).toBeNull();
    expect(screen.getByRole('img', { name: 'Income per month' })).toBeInTheDocument();
    expect(bars(container)).toHaveLength(0);
    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('BarChart: a single bar and missing series values render without NaN', () => {
    const { container } = render(
      <BarChart
        ariaLabel="Income per month"
        data={[{ label: 'Nov 2026', values: { new: 40 } }]}
        series={series}
        stacked
      />,
    );

    expect(bars(container)).toHaveLength(1);
    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('BarChart: bars too thin to part are drawn edge to edge, with a hairline cursor', async () => {
    const user = userEvent.setup();
    // A year of days: each column is under two pixels wide.
    const year = Array.from({ length: 365 }, (_, i) => ({
      label: `Day ${i + 1}`,
      values: { data: 1 + (i % 9) },
    }));
    const { container } = render(
      <BarChart
        ariaLabel="Data per day"
        data={year}
        series={[{ key: 'data', label: 'Data', colorClass: 'text-blue-500' }]}
      />,
    );

    const marks = bars(container);
    expect(marks).toHaveLength(365);
    // Every bar reaches its neighbour: slivers of surface between bars this thin
    // would read as stripes, not as gaps.
    const edges = marks.map((bar) => {
      const d = bar.getAttribute('d')!;
      return { left: Number(/^M([\d.]+) /.exec(d)![1]), right: Number(/H([\d.]+)/.exec(d)![1]) };
    });
    for (let i = 0; i < edges.length - 1; i += 1) {
      expect(edges[i].right).toBeGreaterThanOrEqual(edges[i + 1].left);
    }
    // No bar leaves the plot.
    const plotWidth = Number(container.querySelector('svg[role="img"]')!.getAttribute('viewBox')!.split(' ')[2]);
    expect(edges[0].left).toBe(0);
    expect(edges[edges.length - 1].right).toBeLessThanOrEqual(plotWidth);
    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined/);

    // A tinted band two pixels wide cannot be seen: the column is marked by a hairline.
    const columns = container.querySelectorAll<HTMLElement>('[data-chart-hit]');
    expect(columns[100].querySelector('span')).toBeNull();
    await user.hover(columns[100]);
    expect(columns[100].querySelector('span')).not.toBeNull();
    expect(container.querySelector('[data-chart-tooltip]')).toHaveTextContent('Day 101');
  });

  it('BarChart: yMax fixes the top of the axis and axisFormat labels the ticks', () => {
    const { container } = render(
      <BarChart
        ariaLabel="Renewal rate"
        data={[
          { label: 'Sep 2026', values: { rate: 40 } },
          { label: 'Oct 2026', values: { rate: 62 } },
        ]}
        series={[{ key: 'rate', label: 'Renewal rate', colorClass: 'text-blue-500' }]}
        yMax={100}
        axisFormat={(n) => `${n}%`}
      />,
    );

    const ticks = Array.from(container.querySelectorAll('[data-chart-axis="y"] span')).map(
      (el) => el.textContent,
    );
    expect(ticks).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });

  it('BarChart: a null draws no bar and reads as a dash, a zero draws no bar and reads "0"', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BarChart
        ariaLabel="Renewal rate"
        data={[
          { label: 'Sep 2026', values: { rate: 0 } },
          { label: 'Oct 2026', values: { rate: null } },
          { label: 'Nov 2026', values: { rate: 50 } },
        ]}
        series={rateSeries}
        yMax={100}
        valueFormat={percent}
      />,
    );

    // Nothing rises from the baseline for a zero or for a null.
    expect(bars(container).map((bar) => bar.getAttribute('data-index'))).toEqual(['2']);

    // The hidden data table tells them apart.
    expect(tableRows(container)).toEqual([
      ['Sep 2026', '0%'],
      ['Oct 2026', '—'],
      ['Nov 2026', '50%'],
    ]);

    // Both keep their column, its label on the axis and its accessible name.
    expect(
      Array.from(container.querySelectorAll('[data-chart-axis="x"] span')).map((el) => el.textContent),
    ).toEqual(['Sep 2026', 'Oct 2026', 'Nov 2026']);
    const columns = container.querySelectorAll<HTMLElement>('[data-chart-hit]');
    expect(Array.from(columns).map((column) => column.getAttribute('aria-label'))).toEqual([
      'Sep 2026: Renewal rate 0%',
      'Oct 2026: Renewal rate —',
      'Nov 2026: Renewal rate 50%',
    ]);

    // So does the tooltip.
    await user.hover(columns[0]);
    let tooltip = container.querySelector('[data-chart-tooltip]')!;
    expect(tooltip).toHaveTextContent('Sep 2026');
    expect(tooltip).toHaveTextContent('0%');
    expect(tooltip).not.toHaveTextContent('—');

    await user.hover(columns[1]);
    tooltip = container.querySelector('[data-chart-tooltip]')!;
    expect(tooltip).toHaveTextContent('Oct 2026');
    expect(tooltip).toHaveTextContent('—');
    expect(tooltip).not.toHaveTextContent('%');

    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
  });

  it('BarChart: a null takes no part in the axis', () => {
    const ticksOf = (first: number | null) => {
      const { container, unmount } = render(
        <BarChart
          ariaLabel="Renewal rate"
          data={[
            { label: 'Oct 2026', values: { rate: first } },
            { label: 'Nov 2026', values: { rate: 40 } },
          ]}
          series={rateSeries}
          valueFormat={percent}
        />,
      );
      const ticks = Array.from(container.querySelectorAll('[data-chart-axis="y"] span')).map(
        (el) => el.textContent,
      );
      unmount();
      return ticks;
    };

    // The same round steps from the zero baseline, whether the other month is empty or zero.
    expect(ticksOf(null)).toEqual(['0%', '10%', '20%', '30%', '40%']);
    expect(ticksOf(0)).toEqual(['0%', '10%', '20%', '30%', '40%']);
  });

  it('BarChart: nothing but nulls is the empty block, a single zero among them is a chart', () => {
    const { container, rerender } = render(
      <BarChart
        ariaLabel="Renewal rate"
        data={[
          { label: 'Oct 2026', values: { rate: null } },
          { label: 'Nov 2026', values: { rate: null } },
        ]}
        series={rateSeries}
        valueFormat={percent}
        emptyMessage="No paid plans ended in this period"
      />,
    );
    expect(container.querySelector('[data-chart-empty]')).toHaveTextContent(
      'No paid plans ended in this period',
    );
    expect(container.querySelector('[data-chart="bar"]')).toBeNull();

    rerender(
      <BarChart
        ariaLabel="Renewal rate"
        data={[
          { label: 'Oct 2026', values: { rate: null } },
          { label: 'Nov 2026', values: { rate: 0 } },
        ]}
        series={rateSeries}
        valueFormat={percent}
        emptyMessage="No paid plans ended in this period"
      />,
    );
    // Zero is a figure: the axes are drawn, and the column reads "0%".
    expect(container.querySelector('[data-chart-empty]')).toBeNull();
    expect(screen.getByRole('img', { name: 'Renewal rate' })).toBeInTheDocument();
    expect(bars(container)).toHaveLength(0);
    expect(tableRows(container)).toEqual([
      ['Oct 2026', '—'],
      ['Nov 2026', '0%'],
    ]);
    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
  });

  it('BarChart: a stacked column leaves a null out of its total, and has no total when it has no value', () => {
    const { container } = render(
      <BarChart
        ariaLabel="Income per month"
        data={[
          { label: 'Sep 2026', values: { new: null, renewal: null, planChange: null } },
          { label: 'Oct 2026', values: { new: 100, renewal: null, planChange: 50 } },
          { label: 'Nov 2026', values: { new: 0, renewal: 0, planChange: 0 } },
        ]}
        series={series}
        stacked
        valueFormat={sdg}
      />,
    );

    expect(tableRows(container)).toEqual([
      ['Sep 2026', '—', '—', '—', '—'],
      ['Oct 2026', 'SDG 100', '—', 'SDG 50', 'SDG 150'],
      ['Nov 2026', 'SDG 0', 'SDG 0', 'SDG 0', 'SDG 0'],
    ]);
    // Only October's two values are drawn, one on top of the other.
    expect(
      bars(container).map((bar) => `${bar.getAttribute('data-index')}:${bar.getAttribute('data-series')}`),
    ).toEqual(['1:new', '1:planChange']);
    expect(domDump(container)).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
  });

  it('BarChart: hovering a column shows the tooltip with every series and the total', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BarChart ariaLabel="Income per month" data={months} series={series} stacked valueFormat={sdg} />,
    );
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();

    const columns = container.querySelectorAll<HTMLElement>('[data-chart-hit]');
    expect(columns).toHaveLength(3);
    await user.hover(columns[1]);

    const tooltip = container.querySelector('[data-chart-tooltip]')!;
    expect(tooltip).toHaveTextContent('Oct 2026');
    expect(tooltip).toHaveTextContent('New');
    expect(tooltip).toHaveTextContent('SDG 150');
    expect(tooltip).toHaveTextContent('Renewal');
    expect(tooltip).toHaveTextContent('SDG 250');
    expect(tooltip).toHaveTextContent('Plan change');
    expect(tooltip).toHaveTextContent('SDG 25');
    expect(tooltip).toHaveTextContent('Total');
    expect(tooltip).toHaveTextContent('SDG 425');

    await user.unhover(columns[1]);
    expect(container.querySelector('[data-chart-tooltip]')).toBeNull();
  });

  it('BarChart: exposes role="img" and a hidden data table', () => {
    const { container } = render(
      <BarChart ariaLabel="Income per month" data={months} series={series} stacked valueFormat={sdg} />,
    );

    expect(screen.getByRole('img', { name: 'Income per month' })).toBeInTheDocument();

    const table = container.querySelector('.sr-only table')!;
    expect(table).not.toBeNull();
    const head = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(head.slice(1)).toEqual(['New', 'Renewal', 'Plan change', 'Total']);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Sep 2026');
    expect(rows[0]).toHaveTextContent('SDG 100');
    expect(rows[0]).toHaveTextContent('SDG 200');
    expect(rows[0]).toHaveTextContent('SDG 50');
    expect(rows[0]).toHaveTextContent('SDG 350');

    // More than one series: the legend names them, so identity is never colour alone.
    const legend = container.querySelector('[data-chart-legend]')!;
    expect(legend).toHaveTextContent('New');
    expect(legend).toHaveTextContent('Renewal');
    expect(legend).toHaveTextContent('Plan change');
  });
});
