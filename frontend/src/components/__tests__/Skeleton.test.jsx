/**
 * Skeleton component tests.
 *
 * Verifies that all skeleton variants render correctly and produce
 * the expected shimmer animation elements.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SkeletonCard, SkeletonRow, SkeletonChart, SkeletonVideo, Shimmer } from '../Skeleton';

describe('Shimmer', () => {
  it('renders with the correct base classes', () => {
    const { container } = render(<Shimmer className="h-4 w-20" />);
    const shimmer = container.firstChild;

    expect(shimmer).toBeInTheDocument();
    expect(shimmer).toHaveClass('relative', 'overflow-hidden', 'rounded');
    expect(shimmer).toHaveClass('h-4', 'w-20');
  });

  it('applies custom styles', () => {
    const { container } = render(<Shimmer style={{ height: '50%' }} />);
    const shimmer = container.firstChild;

    expect(shimmer).toHaveStyle({ height: '50%' });
  });
});

describe('SkeletonCard', () => {
  it('renders a card skeleton with shimmer elements', () => {
    const { container } = render(<SkeletonCard />);

    // Should have the outer card wrapper and inner shimmer children
    const shimmers = container.querySelectorAll('.relative.overflow-hidden.rounded');
    expect(shimmers.length).toBeGreaterThanOrEqual(3); // h-3, h-8, h-3
  });
});

describe('SkeletonRow', () => {
  it('renders a row skeleton with icon and text placeholders', () => {
    const { container } = render(<SkeletonRow />);

    // Row has a flex container with shimmer elements
    const row = container.firstChild;
    expect(row).toHaveClass('flex', 'items-center');
  });
});

describe('SkeletonChart', () => {
  it('renders 7 bar shimmer elements', () => {
    const { container } = render(<SkeletonChart />);

    const bars = container.querySelectorAll('.flex-1');
    expect(bars.length).toBe(7);
  });
});

describe('SkeletonVideo', () => {
  it('renders with aspect-video container', () => {
    const { container } = render(<SkeletonVideo />);

    const videoContainer = container.firstChild;
    expect(videoContainer).toHaveClass('aspect-video');
  });
});
