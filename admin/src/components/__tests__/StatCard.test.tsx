import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatCard from '../StatCard';

const icon = <svg data-testid="icon" />;

/** The utilities that cut text off: an ellipsis, a clipped box, a forced single line. */
const CLIPPING = /^(truncate|text-ellipsis|text-clip|whitespace-nowrap|overflow-(x-)?(hidden|clip)|line-clamp-\d+)$/;

/** True when nothing from `el` up to the card itself can cut the text of `el` off. */
function noClipFrom(el: HTMLElement, card: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (Array.from(node.classList).some((name) => CLIPPING.test(name))) return false;
    if (node === card) return true;
  }
  return false;
}

describe('StatCard', () => {
  it('StatCard: shows the delta text and sub line', () => {
    render(
      <StatCard
        title="Income this month"
        value="SDG 1,240,000"
        icon={icon}
        delta={{ text: '+18%', direction: 'up', good: true }}
        sub="vs same days last month"
      />,
    );
    expect(screen.getByText('Income this month')).toBeInTheDocument();
    expect(screen.getByText('SDG 1,240,000')).toBeInTheDocument();
    expect(screen.getByText('+18%')).toBeInTheDocument();
    expect(screen.getByText('vs same days last month')).toBeInTheDocument();
  });

  it('colours the delta by whether it is good news, not by its direction', () => {
    const { rerender } = render(
      <StatCard title="Income" value="1" icon={icon} delta={{ text: '+18%', direction: 'up', good: true }} />,
    );
    expect(screen.getByText('+18%').closest('[data-delta]')).toHaveClass('text-green-700');

    // More quiet operators is an increase, and bad news.
    rerender(
      <StatCard title="Going quiet" value="4" icon={icon} delta={{ text: '+2', direction: 'up', good: false }} />,
    );
    expect(screen.getByText('+2').closest('[data-delta]')).toHaveClass('text-red-700');

    rerender(
      <StatCard title="Income" value="1" icon={icon} delta={{ text: '0%', direction: 'flat', good: true }} />,
    );
    expect(screen.getByText('0%').closest('[data-delta]')).toHaveClass('text-slate-500');
  });

  it('carries the direction on the delta for anything that reads it', () => {
    render(
      <StatCard title="Income" value="1" icon={icon} delta={{ text: '-62%', direction: 'down', good: false }} />,
    );
    expect(screen.getByText('-62%').closest('[data-delta]')).toHaveAttribute('data-delta', 'down');
  });

  it('accepts a node as the sub line', () => {
    render(
      <StatCard
        title="Paying operators"
        value="41"
        icon={icon}
        sub={<span data-testid="granted">+3 granted</span>}
      />,
    );
    expect(screen.getByTestId('granted')).toHaveTextContent('+3 granted');
  });

  it('renders a long value in full: it steps down a size and may wrap, and is never cut off', () => {
    const { container, rerender } = render(
      <StatCard title="Due to renew in 30 days" value="SDG 12,480,000" icon={icon} />,
    );
    const card = container.firstElementChild as HTMLElement;

    // The whole amount is in the page, in one element, with nothing standing in for it.
    let value = screen.getByText('SDG 12,480,000');
    expect(value.textContent).toBe('SDG 12,480,000');
    expect(value).not.toHaveAttribute('title');
    // One size down, so it fits on one line where the cards sit two or four across.
    expect(value).toHaveClass('text-xl');
    expect(noClipFrom(value, card)).toBe(true);
    // Wider than its card, it breaks onto a second line rather than run out of it.
    expect(value).toHaveClass('break-words');

    // The title may still be shortened: the value is what must be read.
    expect(screen.getByText('Due to renew in 30 days')).toHaveClass('truncate');

    // Longer still: another size down, under the same rules.
    rerender(<StatCard title="Sales value" value="SDG 1,248,000,000" icon={icon} />);
    value = screen.getByText('SDG 1,248,000,000');
    expect(value.textContent).toBe('SDG 1,248,000,000');
    expect(value).toHaveClass('text-lg');
    expect(value).toHaveClass('break-words');
    expect(noClipFrom(value, card)).toBe(true);
  });

  it('sets short values as large as the dashboard cards always were', () => {
    const { rerender } = render(<StatCard title="Total Users" value={128} icon={icon} />);
    // A number, a count "of" another, and the longest amount that keeps the full size.
    for (const value of [128, '2 of 5', 'SDG 640,000', 'SDG 1,240,000']) {
      rerender(<StatCard title="Total Users" value={value} icon={icon} />);
      const line = screen.getByText(String(value));
      expect(line).toHaveClass('text-2xl', 'font-bold', 'text-slate-900', 'tabular-nums');
      expect(line).not.toHaveClass('text-xl');
      expect(line).not.toHaveClass('text-lg');
    }
  });

  it('keeps every card the same height, whatever the size of its value', () => {
    const { rerender } = render(<StatCard title="Income" value="SDG 640,000" icon={icon} />);
    expect(screen.getByText('SDG 640,000')).toHaveClass('leading-8');
    rerender(<StatCard title="Income" value="SDG 12,480,000" icon={icon} />);
    expect(screen.getByText('SDG 12,480,000')).toHaveClass('leading-8');
    rerender(<StatCard title="Income" value="SDG 1,248,000,000" icon={icon} />);
    expect(screen.getByText('SDG 1,248,000,000')).toHaveClass('leading-8');
  });

  it('renders the title, value and icon alone when neither is passed', () => {
    const { container } = render(<StatCard title="Total Users" value={128} icon={icon} />);
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(container.querySelector('[data-delta]')).toBeNull();
    // Title and value are the only two lines, as before.
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByText('128').parentElement?.children).toHaveLength(2);
  });
});
