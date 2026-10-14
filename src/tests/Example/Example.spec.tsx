import { expect, test } from 'vitest';
import Example from './Example';
import { render } from '../../utils/test/render';

test('Example', () => {
    expect(true).toBe(true);
});

test('Example 2', () => {
    const screen = render(<Example />);

    const example = screen.findByText('Example');

    expect(example).not.toBeNull();
});
