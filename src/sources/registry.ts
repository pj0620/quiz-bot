import { githubRepoSourceType } from '../features/github/githubSourceType';
import type { SourceTypeDefinition } from './contract';
import type { InfoSource, InfoSourceType } from './types';

/**
 * The single place source types are registered.
 *
 * Because this is a mapped type over InfoSourceType, adding a member to that
 * union without adding an entry here is a compile error — so a new source type
 * cannot be half-wired.
 */
const SOURCE_TYPES: { [K in InfoSourceType]: SourceTypeDefinition<Extract<InfoSource, { type: K }>> } = {
  'github-repo': githubRepoSourceType,
};

/** Drives the "add a source" picker. Adding a type adds a row, with no edits there. */
export function listSourceTypes(): SourceTypeDefinition<InfoSource>[] {
  return Object.values(SOURCE_TYPES) as SourceTypeDefinition<InfoSource>[];
}

export function getSourceTypeDefinition(type: InfoSourceType): SourceTypeDefinition<InfoSource> {
  return SOURCE_TYPES[type] as SourceTypeDefinition<InfoSource>;
}

export function getSourceType(source: InfoSource): SourceTypeDefinition<InfoSource> {
  return getSourceTypeDefinition(source.type);
}
