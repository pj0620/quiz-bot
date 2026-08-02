import { parseNoteName } from './noteName';

/**
 * A markdown parser sized for study notes, not for rendering.
 *
 * It exists to answer one question: what in this note is worth asking about?
 * That makes it different from a renderer in three ways that matter.
 *
 * 1. `![[Pasted image 20260707210812.png]]` is DROPPED AND COUNTED. Obsidian
 *    notes carry a lot of their content in screenshots, which are invisible to
 *    us. A section whose only content is an embed must produce no questions
 *    rather than a confident question about nothing — so the count is kept and
 *    the caller checks it.
 *
 * 2. Structure is inferred when it isn't marked up. Plenty of notes use no `#`
 *    headings at all and lean on short title-case lines instead. Ignoring that
 *    collapses a well-organised note into one undifferentiated wall of text.
 *
 * 3. `Term - definition` lines are extracted as their own block type. They are
 *    the densest quiz material in a typical note and read as ordinary prose to
 *    any parser that isn't looking for them.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type DefinitionEntry = { term: string; definition: string };

export type NoteBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[]; ordered: boolean }
  | { kind: 'definitions'; entries: DefinitionEntry[] };

export type NoteSection = {
  /** Null for the lead-in before the first heading. */
  heading: string | null;
  /** 1-6 for real headings; 0 for the lead-in and for inferred headings. */
  level: number;
  blocks: NoteBlock[];
  /** Image embeds dropped here — content we know exists but cannot read. */
  droppedEmbeds: number;
};

export type ParsedNote = {
  /** Frontmatter title, else the first H1, else the parsed filename title. */
  title: string;
  series?: string;
  index?: number;
  /** Frontmatter tags plus inline #tags, in encounter order. */
  tags: string[];
  /** `[[Wiki Link]]` targets — the vault's own notion of related material. */
  links: string[];
  sections: NoteSection[];
  droppedEmbeds: number;
};

// ---------------------------------------------------------------------------
// Line patterns
// ---------------------------------------------------------------------------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const ORDERED = /^\s*\d+[.)]\s+(.+)$/;
const BLOCKQUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const HORIZONTAL_RULE = /^\s*([-*_])\s*(\1\s*){2,}$/;

/** A line that is nothing but an image embed, in either syntax. */
const EMBED_ONLY = /^\s*(!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\))\s*$/;

/**
 * `Term - definition` or `Term: definition`.
 *
 * The term is capped at four words so an ordinary sentence containing a dash
 * ("Lincoln kept troops out of Kentucky - he did not want to pressure them")
 * stays a paragraph.
 */
const DEFINITION_LINE = /^\s*([^-:–—][^-:–—]{0,48}?)\s*[-–—:]\s+(.{4,})$/;
const MAX_TERM_WORDS = 4;

// ---------------------------------------------------------------------------
// Inline cleanup
// ---------------------------------------------------------------------------

const INLINE_TAG = /(^|\s)#([a-zA-Z][\w/-]*)/g;

/**
 * Strips markdown emphasis and resolves links to their display text.
 *
 * Wiki-link targets and inline tags are collected via the `collect` sink rather
 * than returned, because this runs per-line and threading a return value
 * through every caller would obscure what each pattern is for.
 */
function stripInline(
  input: string,
  collect: { links: string[]; tags: string[] },
): string {
  let text = input;

  // Embeds first: `![[x]]` must not be mistaken for a wiki link.
  text = text.replace(/!\[\[[^\]]*\]\]/g, '');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // `[[Target|Alias]]` displays the alias but relates to the target.
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => {
    const trimmed = target.trim();
    if (trimmed && !collect.links.includes(trimmed)) collect.links.push(trimmed);
    return (alias ?? target).trim();
  });

  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  text = text.replace(INLINE_TAG, (_match, lead: string, tag: string) => {
    if (!collect.tags.includes(tag)) collect.tags.push(tag);
    return lead;
  });

  text = text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/==(.*?)==/g, '$1')
    .replace(/~~(.*?)~~/g, '$1');

  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Inferred headings
// ---------------------------------------------------------------------------

/**
 * Whether a line continues the previous one or starts something new.
 *
 * Markdown says a paragraph runs until a blank line, which is right for prose
 * hard-wrapped at 80 columns. It is wrong for the way notes are actually
 * written — one thought per line, no bullets — where it welds unrelated lines
 * into a single sentence: "Anger over recent draft Lee was considered
 * invincible leaving Confederates with hope." That then gets quoted back as a
 * question, so the damage is visible to the person revising.
 *
 * A lowercase start is the signal that a line is genuinely mid-sentence.
 */
function continuesParagraph(line: string): boolean {
  return /^[a-z]/.test(line);
}

/**
 * Whether a line looks like a heading someone didn't mark up.
 *
 * Purely a heuristic, and deliberately a strict one: guessing wrong costs a
 * paragraph being promoted to a heading, which is harmless, but guessing too
 * eagerly would shred real prose into fake sections. The signals are short,
 * title-cased, unpunctuated, and followed by actual content.
 */
function looksLikeHeading(line: string, next: string | undefined): boolean {
  const text = line.trim();
  if (text.length === 0 || text.length > 60) return false;
  if (/[.,;:!?]$/.test(text)) return false;

  const words = text.split(/\s+/);
  if (words.length > 5) return false;

  // Title Case: every substantial word is capitalised. "Border States" passes;
  // "he did not want to" does not.
  const substantial = words.filter((word) => word.length >= 4);
  if (substantial.length === 0) return false;
  if (!substantial.every((word) => /^[A-Z0-9]/.test(word))) return false;

  // A heading introduces something. A title-cased line at the end of a note, or
  // one followed by a blank line, is more likely a stray fragment.
  return next !== undefined && next.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function parseFrontmatter(block: string): { title?: string; tags: string[] } {
  const tags: string[] = [];
  let title: string | undefined;
  let inTagList = false;

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');

    // A YAML list continues until a line that isn't an item.
    if (inTagList) {
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (item) {
        tags.push(item[1].trim().replace(/^["']|["']$/g, ''));
        continue;
      }
      inTagList = false;
    }

    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;

    if (key.toLowerCase() === 'title') {
      title = value.trim().replace(/^["']|["']$/g, '') || undefined;
      continue;
    }

    if (key.toLowerCase() === 'tags' || key.toLowerCase() === 'topics') {
      const inline = value.trim();
      if (!inline) {
        inTagList = true;
        continue;
      }
      // Both `tags: [a, b]` and `tags: a, b` occur in the wild.
      for (const entry of inline.replace(/^\[|\]$/g, '').split(',')) {
        const tag = entry.trim().replace(/^["']|["']$/g, '');
        if (tag) tags.push(tag);
      }
    }
  }

  return { title, tags };
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** Accumulates consecutive lines of one kind into a block. */
type Pending =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[]; ordered: boolean }
  | { kind: 'definitions'; entries: DefinitionEntry[] }
  | null;

export function parseNote(raw: string, stem: string): ParsedNote {
  const fromName = parseNoteName(stem);
  const collect = { links: [] as string[], tags: [] as string[] };

  let body = raw.replace(/^﻿/, '');
  const frontmatterMatch = FRONTMATTER.exec(body);
  const frontmatter = frontmatterMatch ? parseFrontmatter(frontmatterMatch[1]) : { tags: [] };
  if (frontmatterMatch) body = body.slice(frontmatterMatch[0].length);

  const sections: NoteSection[] = [];
  let current: NoteSection = { heading: null, level: 0, blocks: [], droppedEmbeds: 0 };
  let pending: Pending = null;
  let firstH1: string | undefined;
  let inFence = false;
  // Counted independently of the sections, so an embed in a lead-in that ends
  // up being discarded still shows up in the total.
  let droppedEmbeds = 0;

  function flush(): void {
    if (!pending) return;
    if (pending.kind === 'paragraph') {
      const text = pending.lines.join(' ').trim();
      if (text) current.blocks.push({ kind: 'paragraph', text });
    } else if (pending.kind === 'list') {
      if (pending.items.length > 0) {
        current.blocks.push({ kind: 'list', items: pending.items, ordered: pending.ordered });
      }
    } else if (pending.entries.length > 0) {
      current.blocks.push({ kind: 'definitions', entries: pending.entries });
    }
    pending = null;
  }

  function startSection(heading: string, level: number): void {
    flush();
    // Only keep the lead-in if it actually held something.
    if (current.blocks.length > 0 || current.heading !== null) sections.push(current);
    current = { heading, level, blocks: [], droppedEmbeds: 0 };
  }

  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (FENCE.test(line)) {
      // Code in a study note is incidental; skip the whole fence rather than
      // feed source lines into a prose pipeline.
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (EMBED_ONLY.test(line)) {
      flush();
      current.droppedEmbeds += 1;
      droppedEmbeds += 1;
      continue;
    }

    if (line.trim().length === 0 || HORIZONTAL_RULE.test(line) || TABLE_ROW.test(line)) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = stripInline(heading[2], collect);
      if (level === 1 && firstH1 === undefined && text) firstH1 = text;
      if (text) startSection(text, level);
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    const content = quote ? quote[1] : line;

    const bullet = BULLET.exec(content);
    const ordered = bullet ? null : ORDERED.exec(content);
    if (bullet || ordered) {
      const item = stripInline((bullet ?? ordered)![1], collect);
      const isOrdered = ordered !== null;
      if (pending?.kind === 'list' && pending.ordered === isOrdered) {
        if (item) pending.items.push(item);
      } else {
        flush();
        pending = { kind: 'list', items: item ? [item] : [], ordered: isOrdered };
      }
      continue;
    }

    const cleaned = stripInline(content, collect);
    if (!cleaned) continue;

    const definition = DEFINITION_LINE.exec(cleaned);
    if (definition && definition[1].trim().split(/\s+/).length <= MAX_TERM_WORDS) {
      const entry: DefinitionEntry = {
        term: definition[1].trim(),
        definition: definition[2].trim(),
      };
      if (pending?.kind === 'definitions') {
        pending.entries.push(entry);
      } else {
        flush();
        pending = { kind: 'definitions', entries: [entry] };
      }
      continue;
    }

    /*
      A bare term inside a definition run.

      "Professional Military" sits between two `Term - definition` lines and is
      a fourth item in the same list, not a new heading — it just happens to be
      the one advantage the writer didn't elaborate on. Looking at whether the
      NEXT line continues the list is what separates it from a real heading
      like "Confederate Advantages", which is followed by a screenshot.

      The empty definition is preserved: it still belongs in "name three of the
      Northern advantages", and the generator filters on definition text when it
      needs a definition specifically.
    */
    if (pending?.kind === 'definitions' && looksLikeHeading(cleaned, lines[i + 1])) {
      const next = lines[i + 1] ?? '';
      // A throwaway sink: this is a lookahead, and the line will be collected
      // properly on the next iteration.
      const nextIsEntry = DEFINITION_LINE.test(stripInline(next, { links: [], tags: [] }));
      if (nextIsEntry) {
        pending.entries.push({ term: cleaned, definition: '' });
        continue;
      }
    }

    if (looksLikeHeading(cleaned, lines[i + 1])) {
      startSection(cleaned, 0);
      continue;
    }

    if (pending?.kind === 'paragraph' && continuesParagraph(cleaned)) {
      pending.lines.push(cleaned);
    } else {
      flush();
      pending = { kind: 'paragraph', lines: [cleaned] };
    }
  }

  flush();
  if (current.blocks.length > 0 || current.heading !== null) sections.push(current);

  const tags: string[] = [];
  for (const tag of [...frontmatter.tags, ...collect.tags]) {
    if (tag && !tags.includes(tag)) tags.push(tag);
  }

  return {
    title: frontmatter.title ?? firstH1 ?? fromName.title,
    series: fromName.series,
    index: fromName.index,
    tags,
    links: collect.links,
    sections,
    droppedEmbeds,
  };
}

// ---------------------------------------------------------------------------
// Accessors used by the generator
// ---------------------------------------------------------------------------

/**
 * Flattened prose for a section, for excerpts and model answers.
 *
 * Blocks are joined by newline, not by space: they are separate thoughts, and
 * running them together is what makes an excerpt read as gibberish.
 */
export function sectionText(section: NoteSection): string {
  const parts: string[] = [];
  for (const block of section.blocks) {
    if (block.kind === 'paragraph') parts.push(block.text);
    else if (block.kind === 'list') parts.push(block.items.join('\n'));
    else parts.push(block.entries.map((entry) => `${entry.term}: ${entry.definition}`).join('\n'));
  }
  return parts.join('\n');
}

/**
 * Standalone statements from a section, drawn per block.
 *
 * Deliberately NOT `sentencesOf(sectionText(section))`: sentence splitting on
 * concatenated blocks runs a line with no full stop into the one after it, and
 * the result gets quoted verbatim in true/false and multiple-choice questions.
 * Splitting inside each block keeps every claim to something the note actually
 * says in one place.
 */
export function claimsOf(section: NoteSection): string[] {
  const claims: string[] = [];
  for (const block of section.blocks) {
    if (block.kind === 'paragraph') {
      claims.push(...sentencesOf(block.text));
    } else if (block.kind === 'list') {
      claims.push(...block.items.flatMap((item) => sentencesOf(item)));
    } else {
      claims.push(
        ...block.entries
          .filter((entry) => entry.definition)
          .flatMap((entry) => sentencesOf(`${entry.term}: ${entry.definition}`)),
      );
    }
  }
  return claims.filter((claim, index) => claims.indexOf(claim) === index);
}

/**
 * Whether a section holds enough readable text to ask about.
 *
 * The embed case is the one that matters: "Confederate Advantages" followed
 * only by a screenshot has a heading, looks structured, and contains nothing we
 * can quiz on.
 */
export function isQuizzable(section: NoteSection, minChars = 80): boolean {
  return sectionText(section).length >= minChars;
}

/**
 * Sentences long enough to stand alone, for cloze and true/false material.
 *
 * Split by matching rather than a lookbehind: Hermes' regex engine is not the
 * same as Node's, and a test suite that runs on Node would happily pass a
 * pattern that throws on device.
 */
export function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 220);
}
