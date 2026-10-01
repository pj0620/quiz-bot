import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import { noteStem } from '../../../src/notes/paths';
import { coverageKey } from '../../../src/quiz/generation/coverage';
import { foldersOf, type NoteCandidate } from '../../../src/quiz/generation/selectNotes';
import { saveEdit } from '../../../src/quiz/builder/actions';
import { editBase } from '../../../src/quiz/builder/store';
import { refreshCatalog } from '../../../src/quiz/builder/notesCatalog';
import { DIFFICULTY_LABELS, sameContent } from '../../../src/quiz/builder/planSpec';
import { matchesScope, resolveScope } from '../../../src/quiz/builder/scope';
import {
  MAX_BULLET_CHARS,
  MAX_BULLETS,
  MAX_STYLE_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_TERM_CHARS,
  MAX_TERMS,
  MAX_TITLE_CHARS,
  hasUnacceptedChanges,
  PLAN_DIFFICULTIES,
  PLAN_FORMATS,
  type PlanSpec,
} from '../../../src/quiz/builder/types';
import { useCatalog, usePlan } from '../../../src/quiz/builder/useBuilder';
import { getQuestionLogic } from '../../../src/quiz/questionTypes';
import { useSources } from '../../../src/sources/useSources';
import { Button } from '../../../src/ui/components/Button';
import { Callout } from '../../../src/ui/components/Callout';
import { Card } from '../../../src/ui/components/Card';
import { Chip, ChipGroup } from '../../../src/ui/components/Chip';
import { Disclosure } from '../../../src/ui/components/Disclosure';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { ListEditor, withDraft } from '../../../src/ui/components/ListEditor';
import { LoadingBlock } from '../../../src/ui/components/LoadingBlock';
import { Screen } from '../../../src/ui/components/Screen';
import { SectionHeader } from '../../../src/ui/components/SectionHeader';
import { SegmentedControl } from '../../../src/ui/components/SegmentedControl';
import { TextField } from '../../../src/ui/components/TextField';
import { colors, radius, spacing, themedSheet, type } from '../../../src/ui/theme';

/**
 * Editing a plan by hand — every field the planner writes, plus the one thing
 * only the reader can do: tick individual notes in or out.
 *
 * The notes list is live against the draft, so changing a phrase shows its
 * effect on the very next render. That is the point of evaluating the scope in
 * the app rather than asking the model: the reader can see exactly what a rule
 * catches before saving it.
 */

const PER_NOTE_CHOICES = [2, 3, 4, 5, 6, 8, 10];

/** Other notes offered for hand-picking before a search narrows them. */
const OTHER_NOTES_SHOWN = 60;

const DIFFICULTY_OPTIONS = PLAN_DIFFICULTIES.map((value) => ({ value, label: DIFFICULTY_LABELS[value] }));

/** The presets, plus whatever the plan already uses — the planner may have chosen 7. */
function perNoteChoices(current: number): number[] {
  return PER_NOTE_CHOICES.includes(current) ? PER_NOTE_CHOICES : [...PER_NOTE_CHOICES, current].sort((a, b) => a - b);
}

function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

type Drafts = { focus: string; avoid: string; terms: string; excludeTerms: string };

const EMPTY_DRAFTS: Drafts = { focus: '', avoid: '', terms: '', excludeTerms: '' };

export default function EditPlanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const planId = typeof params.id === 'string' ? params.id : undefined;
  const plan = usePlan(planId);
  const catalog = useCatalog();
  const sources = useSources();

  // The plan in force, never a proposal still waiting on the reader — see `saveHandEdit`.
  const saved = plan ? editBase(plan) : null;
  const [draft, setDraft] = useState<PlanSpec | null>(saved);
  const [pending, setPending] = useState<Drafts>(EMPTY_DRAFTS);
  const [search, setSearch] = useState('');

  // Seeded once per plan, not on every store change — see the question editor.
  useEffect(() => {
    setDraft((current) => current ?? saved);
  }, [saved]);

  useEffect(() => {
    void refreshCatalog();
  }, []);

  /** The draft with typed-but-unadded entries folded in — what Save stores. */
  const complete = useMemo((): PlanSpec | null => {
    if (!draft) return null;
    return {
      ...draft,
      focus: withDraft(draft.focus, pending.focus, MAX_BULLETS, MAX_BULLET_CHARS),
      avoid: withDraft(draft.avoid, pending.avoid, MAX_BULLETS, MAX_BULLET_CHARS),
      scope: {
        ...draft.scope,
        terms: withDraft(draft.scope.terms, pending.terms, MAX_TERMS, MAX_TERM_CHARS),
        excludeTerms: withDraft(draft.scope.excludeTerms, pending.excludeTerms, MAX_TERMS, MAX_TERM_CHARS),
      },
    };
  }, [draft, pending]);

  const dirty = !!complete && !!saved && !sameContent(complete, saved);

  const matched = useMemo(
    () => (complete ? resolveScope(catalog.notes, complete.scope) : []),
    [catalog.notes, complete],
  );
  const folders = useMemo(() => foldersOf(catalog.notes), [catalog.notes]);

  /** Notes a rule would match, but ticked out by hand — offered back. */
  const leftOut = useMemo(() => {
    if (!complete) return [];
    const excluded = new Set(complete.scope.exclude);
    return catalog.notes.filter((note) => excluded.has(coverageKey(note.sourceId, note.path)));
  }, [catalog.notes, complete]);

  const others = useMemo(() => {
    if (!complete) return [];
    const needle = search.trim().toLowerCase();
    const excluded = new Set(complete.scope.exclude);
    return catalog.notes.filter((note) => {
      const key = coverageKey(note.sourceId, note.path);
      if (excluded.has(key) || matchesScope(note, complete.scope)) return false;
      return !needle || note.path.toLowerCase().includes(needle);
    });
  }, [catalog.notes, complete, search]);

  const update = useCallback((patch: Partial<PlanSpec>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const updateScope = useCallback((patch: Partial<PlanSpec['scope']>) => {
    setDraft((current) => (current ? { ...current, scope: { ...current.scope, ...patch } } : current));
  }, []);

  /** A matched note ticked out — or, if it was only in by hand, simply un-picked. */
  const leaveOut = (note: NoteCandidate) => {
    if (!draft) return;
    const key = coverageKey(note.sourceId, note.path);
    updateScope(
      draft.scope.include.includes(key)
        ? { include: draft.scope.include.filter((entry) => entry !== key) }
        : { exclude: [...draft.scope.exclude, key] },
    );
  };

  const bringBack = (note: NoteCandidate) => {
    if (!draft) return;
    const key = coverageKey(note.sourceId, note.path);
    updateScope({ exclude: draft.scope.exclude.filter((entry) => entry !== key) });
  };

  const pick = (note: NoteCandidate) => {
    if (!draft) return;
    updateScope({ include: [...draft.scope.include, coverageKey(note.sourceId, note.path)] });
  };

  const save = () => {
    if (!planId || !complete) return;
    void saveEdit(planId, complete);
    router.back();
  };

  const leave = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Discard your changes?', 'The plan stays as it was.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  if (!plan || !draft || !complete) {
    return (
      <Screen>
        <EmptyState
          icon="help-circle-outline"
          title="No plan to edit yet"
          body="The planner hasn't proposed one. Describe the quiz in the chat first."
          actionTitle="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit plan' }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen>
          {plan.accepted && plan.spec && hasUnacceptedChanges(plan) ? (
            <Callout
              tone="info"
              title={`The planner’s v${plan.spec.version} isn’t accepted`}
              message={`You’re editing v${plan.accepted.version}, the plan in use. Saving replaces that proposal — to take it instead, accept it in the chat.`}
            />
          ) : null}
          <TextField
            label="Title"
            value={draft.title}
            onChangeText={(title) => update({ title })}
            maxLength={MAX_TITLE_CHARS}
            autoCapitalize="sentences"
            autoCorrect
          />
          <TextField
            label="What it's for"
            value={draft.summary}
            onChangeText={(summary) => update({ summary })}
            maxLength={MAX_SUMMARY_CHARS}
            autoCapitalize="sentences"
            autoCorrect
            multiline
          />

          <SectionHeader title="Ask about" accent="success" />
          <ListEditor
            items={draft.focus}
            onChange={(focus) => update({ focus })}
            draft={pending.focus}
            onDraftChange={(focus) => setPending((current) => ({ ...current, focus }))}
            placeholder="Add something to ask about"
            max={MAX_BULLETS}
            maxChars={MAX_BULLET_CHARS}
            icon="checkmark"
            iconColor={colors.success}
          />

          <SectionHeader title="Leave alone" accent="danger" />
          <ListEditor
            items={draft.avoid}
            onChange={(avoid) => update({ avoid })}
            draft={pending.avoid}
            onDraftChange={(avoid) => setPending((current) => ({ ...current, avoid }))}
            placeholder="Add something to steer clear of"
            max={MAX_BULLETS}
            maxChars={MAX_BULLET_CHARS}
            icon="close"
            iconColor={colors.danger}
          />

          <SectionHeader title="Formats" />
          <ChipGroup>
            <Chip label="Any" selected={draft.formats.length === 0} onPress={() => update({ formats: [] })} />
            {PLAN_FORMATS.map((format) => (
              <Chip
                key={format}
                label={getQuestionLogic(format).label}
                selected={draft.formats.includes(format)}
                onPress={() => update({ formats: toggled(draft.formats, format) })}
              />
            ))}
          </ChipGroup>

          <SectionHeader title="Difficulty" />
          <SegmentedControl
            options={DIFFICULTY_OPTIONS}
            value={draft.difficulty}
            onChange={(difficulty) => update({ difficulty })}
          />

          <SectionHeader title="Questions per note" />
          <ChipGroup scroll>
            {perNoteChoices(draft.questionsPerNote).map((count) => (
              <Chip
                key={count}
                label={String(count)}
                selected={draft.questionsPerNote === count}
                onPress={() => update({ questionsPerNote: count })}
              />
            ))}
          </ChipGroup>

          <TextField
            label="Style notes"
            value={draft.style}
            onChangeText={(style) => update({ style })}
            placeholder="e.g. Plain words. Name the book in every question."
            maxLength={MAX_STYLE_CHARS}
            autoCapitalize="sentences"
            autoCorrect
            multiline
          />

          <SectionHeader title={`Notes · ${matched.length} in this plan`} accent="teal" />
          <Card tone="inset">
            <Text style={styles.label}>Notes whose name contains</Text>
            <ListEditor
              items={draft.scope.terms}
              onChange={(terms) => updateScope({ terms })}
              draft={pending.terms}
              onDraftChange={(terms) => setPending((current) => ({ ...current, terms }))}
              placeholder="e.g. Thinking Fast and Slow"
              max={MAX_TERMS}
              maxChars={MAX_TERM_CHARS}
              icon="search-outline"
              iconColor={colors.teal}
            />
            <Text style={styles.label}>But not</Text>
            <ListEditor
              items={draft.scope.excludeTerms}
              onChange={(excludeTerms) => updateScope({ excludeTerms })}
              draft={pending.excludeTerms}
              onDraftChange={(excludeTerms) => setPending((current) => ({ ...current, excludeTerms }))}
              placeholder="e.g. Conclusion"
              max={MAX_TERMS}
              maxChars={MAX_TERM_CHARS}
              icon="remove-circle-outline"
              iconColor={colors.textMuted}
            />
            {folders.length > 1 ? (
              <>
                <Text style={styles.label}>In folders</Text>
                <ChipGroup>
                  <Chip label="Everywhere" selected={draft.scope.folders.length === 0} onPress={() => updateScope({ folders: [] })} />
                  {folders.map((folder) => (
                    <Chip
                      key={folder}
                      label={folder}
                      selected={draft.scope.folders.includes(folder)}
                      onPress={() => updateScope({ folders: toggled(draft.scope.folders, folder) })}
                    />
                  ))}
                </ChipGroup>
              </>
            ) : null}
            {sources.length > 1 ? (
              <>
                <Text style={styles.label}>From</Text>
                <ChipGroup>
                  <Chip label="All sources" selected={draft.scope.sourceIds.length === 0} onPress={() => updateScope({ sourceIds: [] })} />
                  {sources.map((source) => (
                    <Chip
                      key={source.id}
                      label={source.fullName}
                      selected={draft.scope.sourceIds.includes(source.id)}
                      onPress={() => updateScope({ sourceIds: toggled(draft.scope.sourceIds, source.id) })}
                    />
                  ))}
                </ChipGroup>
              </>
            ) : null}
          </Card>

          {catalog.notes.length === 0 && catalog.status === 'loading' ? (
            <LoadingBlock message="Listing your notes…" size="inline" />
          ) : (
            <View style={styles.notes}>
              {matched.length === 0 ? (
                <Text style={styles.warning}>No notes match. Change the phrases above, or pick notes below.</Text>
              ) : null}
              {matched.map((note) => (
                <NoteToggle key={coverageKey(note.sourceId, note.path)} note={note} included onPress={() => leaveOut(note)} />
              ))}
              {leftOut.length > 0 ? (
                <>
                  <Text style={styles.label}>Left out by hand · {leftOut.length}</Text>
                  {leftOut.map((note) => (
                    <NoteToggle key={coverageKey(note.sourceId, note.path)} note={note} included={false} onPress={() => bringBack(note)} />
                  ))}
                </>
              ) : null}
              <Disclosure title="Add notes by hand" value={`${others.length} more`}>
                <TextField value={search} onChangeText={setSearch} placeholder="Search your notes" clearButtonMode="while-editing" />
                {others.slice(0, OTHER_NOTES_SHOWN).map((note) => (
                  <NoteToggle key={coverageKey(note.sourceId, note.path)} note={note} included={false} onPress={() => pick(note)} />
                ))}
                {others.length > OTHER_NOTES_SHOWN ? (
                  <Text style={styles.hint}>Search to find the other {others.length - OTHER_NOTES_SHOWN}.</Text>
                ) : null}
              </Disclosure>
            </View>
          )}

          <Text style={styles.hint}>
            {plan.accepted
              ? 'Saving updates the plan your next batch follows. Questions already written stay as they are.'
              : 'You’ll still accept the plan before anything is written.'}
          </Text>
          <Button title="Save" onPress={save} disabled={!dirty || !complete.title.trim()} />
          <Button title="Cancel" variant="plain" onPress={leave} />
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

function NoteToggle({ note, included, onPress }: { note: NoteCandidate; included: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: included }}
      accessibilityLabel={noteStem(note.path)}
      onPress={onPress}
      style={({ pressed }) => [styles.noteRow, pressed && styles.pressed]}
    >
      <Ionicons
        name={included ? 'checkmark-circle' : 'ellipse-outline'}
        size={20}
        color={included ? colors.primary : colors.textFaint}
      />
      <View style={styles.noteText}>
        <Text style={[styles.noteName, !included && styles.muted]} numberOfLines={2}>
          {noteStem(note.path)}
        </Text>
        {note.folder ? <Text style={styles.noteFolder}>{note.folder}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = themedSheet(() => ({
  fill: { flex: 1 },
  label: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase', marginTop: spacing.xs },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  warning: { ...type.small, color: colors.warning },
  notes: { gap: spacing.xs },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfaceActive },
  noteText: { flex: 1, gap: 1 },
  noteName: { ...type.small, color: colors.text },
  muted: { color: colors.textMuted },
  noteFolder: { ...type.micro, color: colors.textFaint },
}));
