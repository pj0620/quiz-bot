/**
 * Real note content, kept verbatim.
 *
 * `CIVIL_WAR` is an actual note from a user's vault. It is the fixture that
 * matters most, because it breaks the assumptions a parser written against
 * tidy markdown would make: it has no `#` headings at all, its structure is
 * carried by title-cased lines, its lists are `Term - definition` pairs with no
 * bullets, and five of its sections are screenshots we cannot read.
 */
export const CIVIL_WAR = {
  path: 'History/History of America 40 First Year of Fighting.md',
  content: `At first glance, it seems like the north has overwhelming advantages over the south. Commonly believed that Confederacy had no chance of winning.

Northern Advantages
Population - 5:2 ratio of people in north to south
Economic Strength - More factories, railroads, 2x draft animals(horses, etc)
Professional Military
Presidential Leadership - Lincoln proved to be an excellent war leader. Jefferson Davis was also good but not as much as Lincoln
Confederate Advantages
![[Pasted image 20260707210812.png]]

Neutral Factors
![[Pasted image 20260707211113.png]]

Overall it was no means a hopeless attempt by the south and both sides had advantages over the other.

Border States
Both side put a lot of effort in convincing border states to their sides.

![[Pasted image 20260707211427.png]]

If Kentuxky joined the confederacy could defend the ohio river rather than state border. Kentucky overall stayed with the north. Lincoln kept troops out of kentucky early on to not pressure them.

It was a true brothers war in Kentucky. Many families went to either side of the conflict.

Missouri had a "head start" to the war since many had participated in bleeding kansas. It would stay with the union but also sent troops to both armies.

Both states saw bitter guerrilla warfare. The romantic notation if armies lined up fighting is absent in these states during the war.

Lincoln took direct military and political action in Maryland against pro-south politicians and people. Washington DC is in Maryland. Maryland stayed with the Union.

![[Pasted image 20260707212306.png]]

Delaware was least important and had strong ties with the Union.

![[Pasted image 20260707212513.png]]

West Virginia
Another border state CREATED during the war in 1861.

![[Pasted image 20260707212648.png]]

An area with few slaves long in conflict with Virginia. Added as a free state to the union.

Slavery Still Allowed
Slavery was still allowed in these free states. Lincoln did not want to spook them to the south.

By 1861, no fear they were going to join the south.
`,
};

/** A conventionally marked-up note, with frontmatter and real headings. */
export const ANCHORING = {
  path: 'Books/Thinking Fast and Slow 11 Anchoring.md',
  content: `---
title: Anchoring
tags: [psychology, cognitive-bias]
---

# Anchoring

The anchoring effect occurs when people consider a particular value for an
unknown quantity before estimating that quantity. See [[Priming]] for the
related mechanism.

## Two Mechanisms

Anchoring happens by two different mechanisms, which is unusual for a
cognitive bias and worth holding onto.

- Adjustment, which is a deliberate System 2 operation
- Priming, which is an automatic System 1 effect

## Anchoring Index

The anchoring index measures the ratio of the shift in estimates to the shift
in anchors. An index of 100% means people adopted the anchor completely, and
an index of 0% means they ignored it entirely. #stats

\`\`\`
index = (shift in estimate) / (shift in anchor)
\`\`\`
`,
};

/** A second note in the same series, so topic collapsing is observable. */
export const FORT_SUMTER = {
  path: 'History/History of America 39 Fort Sumter.md',
  content: `The war began at Fort Sumter in Charleston harbour in April 1861, when the
garrison was fired upon after refusing to evacuate.

Consequences
Volunteers - Lincoln called for 75000 volunteers within days of the surrender
Upper South - Virginia, Arkansas, Tennessee and North Carolina then seceded
Blockade - The Union declared a blockade of southern ports shortly afterwards

The surrender itself caused no combat deaths, which made the scale of what
followed all the more startling to people at the time.
`,
};

/**
 * One thought per line, no bullets, no terminal punctuation — and a name using
 * " - " as hierarchy. Both patterns come from a real vault and both broke the
 * first version of the parser.
 */
export const FLAT_LINES = {
  path: 'Podcasts/Podcast - Netherlands - The Revolt That Made the modern world.md',
  content: `Provences
Anger over recent draft
Lee was considered invincible leaving Confederates with hope
The northern press had begun to question the whole direction of the war

William of Nassau
Either breath, blood, spit is put into soil
He was raised at the imperial court and inherited enormous estates young
`,
};

/** A section whose entire content is an unreadable screenshot. */
export const EMBED_ONLY_NOTE = {
  path: 'History/Britain in the 70s.md',
  content: `Britain in the 70s

## Strikes
![[Pasted image 20260101000000.png]]

## Inflation
Inflation reached levels not seen since the war, and the government tried
several times to hold wages down by agreement rather than by law.
`,
};
