/*
  `Card` renders an icon, and the icon set reaches for expo-font's native
  module, which does not exist in node. Stubbed to a plain view — nothing here
  asserts anything about an icon.
*/
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

/* See `RegionMap.test.tsx` for why these two libraries are stubbed here. */
jest.mock('react-native-gesture-handler', () => {
  const builder: unknown = new Proxy(() => undefined, {
    get: () => () => builder,
    apply: () => builder,
  });
  return {
    Gesture: new Proxy({}, { get: () => () => builder }),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    createAnimatedComponent: (component: unknown) => component,
    View: require('react-native').View,
  },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: (build: () => unknown) => build(),
  withTiming: (value: unknown) => value,
  runOnJS: (fn: unknown) => fn,
}));

import { create, act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Path } from 'react-native-svg';

import { listGeographyQuestions } from '../../quiz/geography/catalog';
import { listRegions } from '../../quiz/geography/maps';
import type { Question, QuestionBase } from '../../quiz/types';
import { colors } from '../theme';
import { QuestionLocation } from './QuestionLocation';

/*
  The card that replaces "From your notes" once a geography question has been
  answered.

  Two jobs, and the second is the one worth testing hardest: it has to show the
  answer's place on the WHOLE map, and it has to render nothing at all for
  questions that already ended with that map on screen.
*/

const NOW = 1_760_000_000_000;

function render(element: React.ReactElement) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

const findQuestion = (
  subject: Parameters<typeof listGeographyQuestions>[0][number],
  format: Question['format'],
) => {
  const question = listGeographyQuestions([subject], 1, NOW).find(
    (candidate) => candidate.format === format,
  );
  if (!question) throw new Error(`no ${format} question for ${subject}`);
  return question;
};

const texts = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Text).flatMap((node) => {
    const children = node.props.children;
    return typeof children === 'string' ? [children] : [];
  });

describe('shape questions', () => {
  it('draws the whole map, not just the outline that was asked about', () => {
    /*
      The entire point of the card. Being shown an isolated outline and told
      "that was Vermont" answers the question without teaching the geography —
      where it sits is the part a bare outline withholds.
    */
    const tree = render(<QuestionLocation question={findQuestion('us-states', 'short-answer')} />);

    expect(tree.root.findAllByType(Path)).toHaveLength(listRegions('us-states').length);
  });

  it('highlights the answer, and only the answer', () => {
    const question = findQuestion('us-states', 'short-answer');
    const region = listRegions('us-states').find(
      (candidate) => candidate.id === question.figure?.regionId,
    )!;
    const paths = render(<QuestionLocation question={question} />).root.findAllByType(Path);

    const highlighted = paths.filter((path) => path.props.fill === colors.success);
    expect(highlighted).toHaveLength(1);
    // The one that stands out is the region the question was about, not merely
    // some region — the map is drawn in table order, so position proves nothing.
    expect(highlighted[0].props.d).toBe(region.d);
  });

  it('names the region, because a highlight alone can be a few pixels wide', () => {
    const question = findQuestion('europe', 'multiple-choice');
    const region = listRegions('europe').find(
      (candidate) => candidate.id === question.figure?.regionId,
    )!;

    expect(texts(render(<QuestionLocation question={question} />))).toContain(region.name);
  });

  it('uses the map the question came from', () => {
    // A continent question gets the world, a Europe question gets Europe.
    const continents = render(<QuestionLocation question={findQuestion('continents', 'short-answer')} />);
    expect(continents.root.findAllByType(Path)).toHaveLength(listRegions('continents').length);
    expect(texts(continents)).toContain('Continents');
  });
});

describe('map questions', () => {
  it('renders nothing, because the answer view already ended on that map', () => {
    // Two identical maps stacked would be the alternative.
    const tree = render(<QuestionLocation question={findQuestion('us-states', 'map-locate')} />);
    expect(tree.root.findAllByType(Path)).toHaveLength(0);
  });
});

describe('everything else', () => {
  it('renders nothing for a question written from a note', () => {
    const question: Question = {
      id: 'q1',
      prompt: 'Which state did Lincoln keep troops out of?',
      explanation: 'Kentucky.',
      topics: ['history-of-america'],
      difficulty: 'core',
      sourceId: 'github-repo:1',
      provenance: { sourceId: 'github-repo:1', path: 'History/Border States.md' },
      addedAt: NOW,
      format: 'short-answer',
      modelAnswer: 'Kentucky',
    } satisfies QuestionBase & { format: 'short-answer'; modelAnswer: string };

    // A note question must fall through to `NoteSource`, which is what the
    // screens do when this renders nothing.
    expect(render(<QuestionLocation question={question} />).root.findAllByType(Path)).toHaveLength(
      0,
    );
  });
});
