/*
  `Card` and `ListRow` render icons, and the icon set reaches for expo-font's
  native module, which does not exist in node. Stubbed to nothing — no test
  here asserts anything about an icon.
*/
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';

import { computeStats } from '../../quiz/stats';
import { summarizeTopics } from '../../quiz/topicStats';
import type { MultipleChoiceQuestion, ReviewState, Session } from '../../quiz/types';
import { ActivityCard, MasteryCard, ScoreCard } from './StatsCards';
import { TopicRow } from './TopicRow';

/*
  The cards shared by the Stats tab and the per-topic screen. Rendered against
  real `computeStats` output rather than hand-built values, so a change to the
  shape of `Stats` breaks here before it breaks on a phone.
*/

const NOW = new Date('2026-08-02T12:00:00').getTime();

function question(id: string): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['history'],
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1', path: 'a.md' },
    addedAt: NOW,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

/** Answered once, correctly, and due again now. */
function learning(questionId: string): ReviewState {
  return {
    questionId,
    ease: 2.5,
    intervalDays: 1,
    dueAt: NOW,
    streak: 1,
    lapses: 0,
    reps: 1,
    lastReviewedAt: NOW,
    lastOutcome: 'correct',
  };
}

const session: Session = {
  id: 's1',
  quizName: 'Daily quiz',
  status: 'completed',
  startedAt: NOW,
  completedAt: NOW,
  seed: 1,
  currentIndex: 2,
  items: [
    { questionId: 'q1', outcome: 'correct', answeredAt: NOW, wasNew: true },
    { questionId: 'q2', outcome: 'incorrect', answeredAt: NOW, wasNew: true },
  ],
};

const input = {
  questions: [question('q1'), question('q2')],
  reviewStates: { q1: learning('q1') },
  sessions: [session],
  now: NOW,
};

const stats = computeStats(input);

function render(element: React.ReactElement) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

type Tree = ReturnType<typeof create>;
type Rendered = ReturnType<Tree['toJSON']>;

/**
 * Everything pressable, found by what it declares rather than by component:
 * the test renderer sees `Pressable` through the wrappers React Native puts
 * around it, so matching on the type finds nothing.
 */
function buttons(tree: Tree) {
  return tree.root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function',
  );
}

/**
 * Every string on screen, in order.
 *
 * Adjacent strings inside one `Text` are joined as written ("50" + "%"), and
 * separate elements are joined with a space, so assertions can be made
 * against what a reader would see rather than against JSX fragments.
 */
function textOf(node: Rendered | Rendered[] | string | undefined): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const children = node.children ?? [];
  return node.type === 'Text' ? children.map(textOf).join('') : children.map(textOf).join(' ');
}

describe('MasteryCard', () => {
  it('states the mastery percentage and the size of what it covers', () => {
    const text = textOf(render(<MasteryCard stats={stats} />).toJSON());
    // One learning question (a quarter of the way) and one new (nowhere), so
    // an eighth on average.
    expect(text).toContain('13%');
    expect(text).toContain('across 2 questions');
    expect(text).toContain('Learning 1');
    expect(text).toContain('New 1');
  });

  it('becomes a button, with its accessory, when given somewhere to go', () => {
    const onPress = jest.fn();
    const tree = render(
      <MasteryCard stats={stats} onPress={onPress} titleAccessory={<Text>By topic</Text>} />,
    );

    expect(textOf(tree.toJSON())).toContain('By topic');
    const [button] = buttons(tree);
    expect(button).toBeDefined();
    act(() => {
      button.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not a button otherwise', () => {
    expect(buttons(render(<MasteryCard stats={stats} />))).toHaveLength(0);
  });
});

describe('ActivityCard', () => {
  it('says how much was answered today', () => {
    const text = textOf(render(<ActivityCard stats={stats} now={NOW} />).toJSON());
    expect(text).toContain('2 answered today');
    expect(text).toContain('peak 2');
  });
});

describe('ScoreCard', () => {
  it('mentions what is waiting for review', () => {
    const text = textOf(render(<ScoreCard stats={stats} now={NOW} />).toJSON());
    expect(text).toContain('1 ready to review now');
  });

  it('keeps quiet about it when the screen says so elsewhere', () => {
    const text = textOf(render(<ScoreCard stats={stats} now={NOW} showDue={false} />).toJSON());
    expect(text).not.toContain('ready to review');
  });
});

describe('TopicRow', () => {
  it('summarises mastery, size, answers and what is due', () => {
    const [topic] = summarizeTopics(input);
    const text = textOf(render(<TopicRow topic={topic} />).toJSON());
    expect(text).toContain('History');
    expect(text).toContain('Learning · 2 questions · 1/2 right · 1 due');
  });

  it('leaves out what has not happened yet', () => {
    const [topic] = summarizeTopics({ ...input, reviewStates: {}, sessions: [] });
    const text = textOf(render(<TopicRow topic={topic} />).toJSON());
    expect(text).toContain('New · 2 questions');
    expect(text).not.toContain('right');
    expect(text).not.toContain('due');
  });
});
