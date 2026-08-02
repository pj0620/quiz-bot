import { Ionicons } from '@expo/vector-icons';

import { Badge } from '../../../ui/components/Badge';
import { ListRow } from '../../../ui/components/ListRow';
import { colors } from '../../../ui/theme';
import type { Repository } from '../types';

type Props = {
  repo: Repository;
  selected: boolean;
  alreadyAdded: boolean;
  onToggle: () => void;
};

export function RepoRow({ repo, selected, alreadyAdded, onToggle }: Props) {
  const badges = [
    repo.private ? 'Private' : 'Public',
    repo.archived ? 'Archived' : null,
    repo.default_branch,
  ].filter(Boolean) as string[];

  return (
    <ListRow
      title={repo.name}
      subtitle={badges.join(' · ')}
      disabled={alreadyAdded}
      onPress={alreadyAdded ? undefined : onToggle}
      accessory={
        alreadyAdded ? (
          <Badge label="Added" />
        ) : (
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={selected ? colors.primary : colors.textFaint}
          />
        )
      }
    />
  );
}
