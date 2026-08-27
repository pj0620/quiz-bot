import type { QuestionFigure } from '../../quiz/types';
import { RegionMap } from './RegionMap';

/**
 * Draws a question's figure, whatever kind it turns out to be.
 *
 * One component rather than a branch at each call site, because the figure is
 * on `QuestionBase` and so every screen that renders a prompt may meet one: the
 * player, the read-only question screen, and anything later that shows a
 * question in full. A `switch` here means adding a second kind of figure
 * touches this file and nothing else.
 *
 * Deliberately renders NOTHING for an unknown kind rather than a placeholder.
 * The only way to get one is a question stored by a future version and read by
 * an older one, and in that case a silently missing picture beats a broken-image
 * box in the middle of the quiz.
 */
export function QuestionFigureView({ figure }: { figure: QuestionFigure }) {
  switch (figure.kind) {
    case 'region-shape':
      return (
        <RegionMap
          mapId={figure.mapId}
          regionIds={[figure.regionId]}
          /*
            Static: this is the QUESTION, not the answer. A pannable outline
            would invite the reader to drag it around looking for context that
            has deliberately been cropped away — the shape alone is the point.
          */
          mode="static"
          height={220}
        />
      );
    default:
      return null;
  }
}
