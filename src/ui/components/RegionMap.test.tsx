/*
  Reanimated is stubbed, and the stub is scoped to this file rather than added
  to the project's jest config.

  It has to be stubbed at all because importing it outside an app pulls in
  `react-native-worklets`, which reaches for native state that does not exist in
  node and throws before a single test runs. Keeping the stub local means the
  other thousand-odd tests — none of which touch React — keep running against an
  untouched config.

  The cost is honest and worth naming: the transform this component animates is
  a no-op here, so these tests verify what is DRAWN and what is TAPPABLE, not
  what panning and pinching do.
*/
jest.mock('react-native-gesture-handler', () => {
  /*
    A gesture builder that accepts any chain and does nothing.

    `GestureDetector` reaches deep into Reanimated's internals, so a partial
    Reanimated stub only moves the failure one library along. Replacing the
    whole gesture layer draws the boundary in the honest place instead: these
    tests are about what the map DRAWS, and the gestures are verified on a
    device.
  */
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
  // The library's own shipped mock is no use here: it re-imports the real
  // entry point, which is what pulls in worklets in the first place.
  default: {
    createAnimatedComponent: (component: unknown) => component,
    View: require('react-native').View,
  },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  // Evaluated eagerly, so the transform it builds is a plain style object.
  useAnimatedStyle: (build: () => unknown) => build(),
  withTiming: (value: unknown) => value,
  runOnJS: (fn: unknown) => fn,
}));

import { create, act } from 'react-test-renderer';
import { View } from 'react-native';
import { G, Path } from 'react-native-svg';

import { listRegions } from '../../quiz/geography/maps';
import { RegionMap } from './RegionMap';

/*
  A render smoke test — the only one in the codebase, and deliberately so.

  Everything else here is tested as pure logic precisely so it needs no
  renderer. The map is the exception worth the exception: it is the one place
  the app leans on three native libraries at once (SVG, gesture-handler,
  Reanimated), and a mistake there does not fail a type check or a logic test.
  It fails as a blank rectangle where the question should be.

  What this does NOT cover, and cannot in jest: the gestures themselves. Pan,
  pinch and double-tap-to-reset run on the UI thread through Reanimated, so they
  need a device or simulator to verify.
*/

function render(element: React.ReactElement) {
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

const paths = (tree: ReturnType<typeof create>) => tree.root.findAllByType(Path);

describe('interactive map', () => {
  it('draws one path per region it is given', () => {
    const tree = render(
      <RegionMap mapId="us-states" regionIds={['us-tn', 'us-ky', 'us-ga']} mode="interactive" />,
    );

    expect(paths(tree)).toHaveLength(3);
  });

  it('draws the whole map when no regions are named', () => {
    const tree = render(<RegionMap mapId="us-states" mode="interactive" />);

    expect(paths(tree)).toHaveLength(listRegions('us-states').length);
  });

  it('gives every path real geometry to draw', () => {
    const tree = render(<RegionMap mapId="europe" mode="interactive" />);

    for (const path of paths(tree)) {
      expect(typeof path.props.d).toBe('string');
      expect(path.props.d.startsWith('M')).toBe(true);
    }
  });

  it('reports the region that was tapped', () => {
    const onSelect = jest.fn();
    const tree = render(
      <RegionMap
        mapId="us-states"
        regionIds={['us-tn', 'us-ky']}
        mode="interactive"
        onSelect={onSelect}
      />,
    );

    /*
      Found by its geometry rather than by position, because drawing order
      follows the MAP TABLE and not the order the ids were passed in — Kentucky
      is drawn first here despite Tennessee being named first.
    */
    const tennessee = listRegions('us-states').find((region) => region.id === 'us-tn')!;
    const path = paths(tree).find((candidate) => candidate.props.d === tennessee.d)!;

    act(() => {
      path.props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith('us-tn');
  });

  it('draws in map order, not in the order the ids were given', () => {
    // Pinned because it is load-bearing for the test above, and because a map
    // that reordered itself per question would flicker between questions.
    const tree = render(
      <RegionMap mapId="us-states" regionIds={['us-tn', 'us-ky']} mode="interactive" />,
    );
    const order = listRegions('us-states')
      .filter((region) => region.id === 'us-tn' || region.id === 'us-ky')
      .map((region) => region.d);

    expect(paths(tree).map((path) => path.props.d)).toEqual(order);
  });

  it('stops accepting taps once the answer is out', () => {
    const onSelect = jest.fn();
    const tree = render(
      <RegionMap
        mapId="us-states"
        regionIds={['us-tn', 'us-ky']}
        mode="interactive"
        correctId="us-tn"
        onSelect={onSelect}
      />,
    );

    // Every path goes inert, so a reader cannot change their answer after
    // seeing which one was right.
    for (const path of paths(tree)) expect(path.props.onPress).toBeUndefined();
  });

  it('marks the right answer even when the reader missed it', () => {
    const tree = render(
      <RegionMap
        mapId="us-states"
        regionIds={['us-tn', 'us-ky']}
        mode="interactive"
        selectedId="us-ky"
        correctId="us-tn"
      />,
    );

    // Showing that you were wrong without showing what was right teaches
    // nothing — the same rule `ChoiceRow` follows.
    const fills = paths(tree).map((path) => path.props.fill);
    expect(new Set(fills).size).toBe(2);
  });

  it('renders nothing for a map that does not exist', () => {
    const tree = render(<RegionMap mapId="atlantis" mode="interactive" />);
    expect(paths(tree)).toHaveLength(0);
  });

  it('puts the pan/zoom transform on a View, never on an SVG group', () => {
    /*
      A regression test for a shipped bug, and an unusually literal one.

      The transform used to sit on an `Animated.G`. `react-native-svg` has no
      Reanimated integration at all — no dependency, no peer dependency, no prop
      updaters — so the animated transform was written to a native view with no
      idea what to do with it. Every gesture fired correctly and the map never
      moved once, which from the outside looked like the gestures were broken.

      Nothing could have caught that at runtime: no error, no warning, no failed
      type. So what is pinned is the structural decision itself — the transform
      belongs on a plain View, and an SVG group must never carry one.
    */
    const tree = render(<RegionMap mapId="us-states" mode="interactive" />);

    const hasTransform = (style: unknown): boolean =>
      (Array.isArray(style) ? style : [style]).some(
        (entry) => !!entry && typeof entry === 'object' && 'transform' in entry,
      );

    expect(tree.root.findAllByType(View).some((view) => hasTransform(view.props.style))).toBe(true);

    for (const group of tree.root.findAllByType(G)) {
      expect(group.props.transform).toBeUndefined();
      expect(hasTransform(group.props.style)).toBe(false);
    }
  });
});

describe('static figure', () => {
  it('is inert — it is the question, not an answer', () => {
    const tree = render(<RegionMap mapId="us-states" regionIds={['us-tn']} mode="static" />);

    const [path] = paths(tree);
    expect(path.props.onPress).toBeUndefined();
    expect(path.props.pointerEvents).toBe('none');
  });

  it('frames itself to the shape rather than to the whole map', () => {
    /*
      The reason `mode` exists. Tennessee drawn in the US viewBox is a sliver in
      the middle of an empty rectangle, and "which state is this?" is
      unanswerable when the state is twelve pixels wide.
    */
    const shape = render(<RegionMap mapId="us-states" regionIds={['us-tn']} mode="static" />);
    const whole = render(<RegionMap mapId="us-states" mode="interactive" />);

    const viewBoxOf = (tree: ReturnType<typeof create>) =>
      tree.root.findAll((node) => typeof node.props?.viewBox === 'string')[0].props.viewBox;

    expect(viewBoxOf(shape)).not.toBe(viewBoxOf(whole));

    const [, , width] = viewBoxOf(shape).split(' ').map(Number);
    expect(width).toBeLessThan(1000);
  });
});
