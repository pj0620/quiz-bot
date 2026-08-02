import { parseNote, type ParsedNote } from '../../notes/parse';
import { noteStem } from '../../notes/paths';

/**
 * The note the Test button generates from.
 *
 * Written in the shape real notes actually take rather than as tidy markdown:
 * no `#` headings, structure carried by title-case lines, `Term - definition`
 * pairs, and an unreadable image embed. Testing against clean prose would prove
 * the connection works while saying nothing about whether generation copes with
 * the material it will really be given.
 *
 * Short on purpose — one test call should cost a fraction of a cent.
 */
const SAMPLE_MARKDOWN = `At first glance the north has overwhelming advantages over the south, and it is commonly believed the Confederacy had no chance of winning.

Northern Advantages
Population - 5:2 ratio of people in north to south
Economic Strength - More factories, railroads, and twice the draft animals
Professional Military
Presidential Leadership - Lincoln proved an excellent war leader

Confederate Advantages
![[Pasted image 20260707210812.png]]

Border States
Kentucky stayed with the Union, and Lincoln kept troops out of it early on so as not to pressure it towards the Confederacy. Missouri also stayed with the Union but sent troops to both armies.

West Virginia
A border state created during the war in 1861, from an area with few slaves that had long been in conflict with Virginia. It was added to the Union as a free state.

Slavery Still Allowed
Slavery was still permitted in the border states that remained in the Union. Lincoln did not want to push them towards the south.
`;

export const SAMPLE_NOTE_PATH = 'History/History of America 40 First Year of Fighting.md';

export function getSampleNote(): ParsedNote {
  return parseNote(SAMPLE_MARKDOWN, noteStem(SAMPLE_NOTE_PATH));
}
