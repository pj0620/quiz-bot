import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DEFAULT_TERMINAL_FX, setTerminalFx, terminalFxStore } from '../terminalFx';
import { DEFAULT_THEME, setTheme } from '../theme';
import { TypewriterText } from './TypewriterText';

/*
  Fake timers drive the typing; the reduce-motion query is a promise, so tests
  flush the microtask queue with an async act before asserting.
*/

const PROMPT = 'WHICH STATE IS THIS?';

let mounted: ReactTestRenderer | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});

afterEach(async () => {
  // Unmount BEFORE resetting stores or timers: a store reset would re-render
  // the leftover tree outside act, and a commit left pending across teardown
  // takes the whole worker down with it.
  await act(async () => {
    mounted?.unmount();
  });
  mounted = undefined;
  setTheme(DEFAULT_THEME);
  terminalFxStore.set(DEFAULT_TERMINAL_FX);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  await act(async () => {
    mounted = create(element);
  });
  return mounted!;
}

/** Every string in the tree that a sighted reader would actually see. */
function visibleText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .flatMap((text) => {
      const style = [text.props.style].flat(Infinity).filter(Boolean) as { color?: string }[];
      if (style.some((entry) => entry.color === 'transparent')) return [];
      const children = Array.isArray(text.props.children) ? text.props.children : [text.props.children];
      return children.filter((child): child is string => typeof child === 'string');
    })
    .join('');
}

describe('TypewriterText', () => {
  it('renders plain, complete text outside the Terminal theme', async () => {
    const tree = await render(<TypewriterText text={PROMPT} selectable />);
    const text = tree.root.findByType(Text);
    expect(text.props.children).toBe(PROMPT);
    expect(text.props.selectable).toBe(true);
  });

  it('renders plain text in Terminal when the switch is off', async () => {
    setTheme('terminal');
    setTerminalFx({ typewriter: false });
    const tree = await render(<TypewriterText text={PROMPT} />);
    expect(tree.root.findByType(Text).props.children).toBe(PROMPT);
  });

  it('types the text out under a cursor, then settles to plain text', async () => {
    setTheme('terminal');
    const tree = await render(<TypewriterText text={PROMPT} selectable />);

    // Mid-type: some of the prompt visible, the rest hidden, cursor on screen.
    await act(async () => {
      jest.advanceTimersByTime(4 * 24);
    });
    const during = visibleText(tree);
    expect(during.length).toBeGreaterThan(0);
    expect(during.length).toBeLessThan(PROMPT.length);
    expect(during).toContain('█');
    expect(PROMPT.startsWith(during.replace('█', ''))).toBe(true);

    // Screen readers get the whole prompt from the first frame.
    const root = tree.root.findAllByType(Text)[0];
    expect(root.props.accessibilityLabel).toBe(PROMPT);
    // The FULL text is laid out from the start — invisible, so the page
    // cannot reflow as characters appear.
    expect(root.props.children.join?.('') ?? '').toContain(PROMPT.slice(0, 8));

    // Let the typing and the parting blinks run out.
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    const settled = tree.root.findByType(Text);
    expect(settled.props.children).toBe(PROMPT);
    expect(settled.props.selectable).toBe(true);
    expect(visibleText(tree)).not.toContain('█');
  });

  it('types in Amber too — the effect follows the crt flag, not the theme name', async () => {
    setTheme('amber');
    const tree = await render(<TypewriterText text={PROMPT} />);
    await act(async () => {
      jest.advanceTimersByTime(4 * 24);
    });
    const during = visibleText(tree);
    expect(during.length).toBeLessThan(PROMPT.length);
    expect(during).toContain('█');
  });

  it('prints instantly when the system asks for reduced motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    setTheme('terminal');
    const tree = await render(<TypewriterText text={PROMPT} />);
    expect(tree.root.findByType(Text).props.children).toBe(PROMPT);
  });
});
