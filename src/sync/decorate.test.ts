import { describe, expect, it } from 'vitest'

import {
  COMMENTS_MARKER,
  decorateSummary,
  normaliseGoogleText,
  notesDigest,
  prefixesFor,
  renderDescription,
  renderTitleText,
  stripCommentsBlock,
  stripSummaryDecoration,
  titleHash,
  type DecorationOptions,
} from './decorate.js'

const options: DecorationOptions = {
  priorityPrefixes: true,
  labelPrefixes: [
    { match: '5min', prefix: '@5min' },
    { match: '30min', prefix: '@30min' },
    { match: 'urgent', prefix: '@urg' },
  ],
}

const item = (priority = 1, labels: string[] = []) => ({ priority, labels })

describe('prefixesFor', () => {
  it('maps Todoist priority to !P labels, remembering the scale is inverted', () => {
    expect(prefixesFor(item(4), options)).toEqual(['!p1'])
    expect(prefixesFor(item(3), options)).toEqual(['!p2'])
    expect(prefixesFor(item(2), options)).toEqual(['!p3'])
    // p4 is Todoist's "no priority" default and deserves no marker.
    expect(prefixesFor(item(1), options)).toEqual([])
  })

  it('honours the priority toggle but still matches labels', () => {
    const off = { ...options, priorityPrefixes: false }
    expect(prefixesFor(item(4, ['5min']), off)).toEqual(['@5min'])
  })

  // Real labels carry emoji and spacing; matching has to see through both.
  it.each([
    ['⚡5min', '@5min'],
    ['⚡ 5min', '@5min'],
    ['5 min', '@5min'],
    ['5min ⏱', '@5min'],
    ['🔥urgent', '@urg'],
    ['URGENT!', '@urg'],
    ['⏳ 30min', '@30min'],
  ])('matches label %s to %s', (label, prefix) => {
    expect(prefixesFor(item(1, [label]), options)).toEqual([prefix])
  })

  // A plain substring test would tag every 15- and 45-minute label as 5min.
  it.each(['15min', '45min', '25 min', '⚡15min'])(
    'does not match %s as 5min',
    (label) => {
      expect(prefixesFor(item(1, [label]), options)).toEqual([])
    },
  )

  it('ignores unrelated labels', () => {
    expect(prefixesFor(item(1, ['@home', 'errand']), options)).toEqual([])
  })

  it('orders by config, not by label order, so titles stay stable', () => {
    const a = prefixesFor(item(4, ['urgent', '5min']), options)
    const b = prefixesFor(item(4, ['5min', 'urgent']), options)

    expect(a).toEqual(['!p1', '@5min', '@urg'])
    expect(b).toEqual(a)
  })

  it('emits each prefix once even when several labels match it', () => {
    expect(prefixesFor(item(1, ['⚡5min', '5 min']), options)).toEqual(['@5min'])
  })
})

describe('summary decoration', () => {
  it('prepends nothing when there is nothing to say', () => {
    expect(decorateSummary('Buy milk', item(1), options)).toBe('Buy milk')
  })

  it('prepends priority and label prefixes', () => {
    expect(decorateSummary('Buy milk', item(4, ['⚡5min']), options)).toBe(
      '!p1 @5min Buy milk',
    )
  })
})

describe('renderTitleText', () => {
  it('flattens a markdown link to its text', () => {
    expect(
      renderTitleText(
        'Prendre [rendez-vous chez le dentiste](https://www.doctolib.fr/search?around_me=true&keyword=dentiste)',
      ),
    ).toBe('Prendre rendez-vous chez le dentiste')
  })

  it('handles a url containing brackets and parentheses', () => {
    expect(
      renderTitleText('See [the docs](https://example.com/a_(b)/c?x=1&y=2)'),
    ).toBe('See the docs')
  })

  it('flattens several links in one title', () => {
    expect(
      renderTitleText('[a](https://a.com) and [b](https://b.com)'),
    ).toBe('a and b')
  })

  it("flattens Todoist's own url (text) format", () => {
    expect(renderTitleText('https://doctolib.fr (dentiste)')).toBe('dentiste')
  })

  it('leaves a plain title untouched', () => {
    expect(renderTitleText('Buy milk')).toBe('Buy milk')
  })

  // Removing it would leave nothing at all, which is worse than a long title.
  it('leaves a bare url alone', () => {
    expect(renderTitleText('https://example.com/thing')).toBe(
      'https://example.com/thing',
    )
  })

  it('tidies the whitespace a removal leaves behind', () => {
    expect(renderTitleText('Call [Bob](https://x.com)  now')).toBe('Call Bob now')
  })
})

describe('titleHash', () => {
  it('matches for the same title and differs for a changed one', () => {
    expect(titleHash('!p1 Buy milk')).toBe(titleHash('!p1 Buy milk'))
    expect(titleHash('!p1 Buy milk')).not.toBe(titleHash('!p1 Buy bread'))
  })

  it('ignores surrounding whitespace, which Google may trim', () => {
    expect(titleHash('  !p1 Buy milk  ')).toBe(titleHash('!p1 Buy milk'))
  })
})

describe('stripSummaryDecoration', () => {
  // Titles written by an earlier version used uppercase !P1.
  it('strips the old uppercase priority tokens too', () => {
    expect(stripSummaryDecoration('!P1 @5min Buy milk', options)).toBe('Buy milk')
  })

  // The property the whole design rests on.
  it('is the exact inverse of decoration', () => {
    for (const priority of [1, 2, 3, 4]) {
      for (const labels of [[], ['⚡5min'], ['🔥urgent'], ['⚡5min', 'urgent']]) {
        const decorated = decorateSummary('Buy milk', item(priority, labels), options)
        expect(stripSummaryDecoration(decorated, options)).toBe('Buy milk')
      }
    }
  })

  // Idempotence is what stops prefixes compounding on every calendar edit.
  it('is idempotent, and cleans up an already-doubled title', () => {
    const once = stripSummaryDecoration('!p1 @5min Buy milk', options)
    expect(stripSummaryDecoration(once, options)).toBe(once)
    expect(stripSummaryDecoration('!p1 @5min !p1 @5min Buy milk', options)).toBe(
      'Buy milk',
    )
  })

  it('leaves an undecorated title untouched', () => {
    expect(stripSummaryDecoration('Buy milk', options)).toBe('Buy milk')
  })

  // Only the vocabulary this app emits is stripped.
  it('preserves tokens the user typed themselves', () => {
    expect(stripSummaryDecoration('@home Buy milk', options)).toBe('@home Buy milk')
    expect(stripSummaryDecoration('!P9 Buy milk', options)).toBe('!P9 Buy milk')
  })

  it('strips a prefix that appears mid-title only at the start', () => {
    expect(stripSummaryDecoration('Buy milk @5min', options)).toBe('Buy milk @5min')
  })

  // Turning the feature off should clean existing titles, not entrench them.
  it('still strips priority tokens when emitting them is disabled', () => {
    const off = { ...options, priorityPrefixes: false }
    expect(stripSummaryDecoration('!p1 Buy milk', off)).toBe('Buy milk')
  })

  it('keeps the original when a title is nothing but prefixes', () => {
    expect(stripSummaryDecoration('!p1 @5min', options)).toBe('!p1 @5min')
  })
})

describe('comments in the description', () => {
  const notes = [
    { content: 'first', postedAt: '2026-08-09T10:00:00Z' },
    { content: 'second', postedAt: '2026-08-10T11:00:00Z' },
  ]

  it('leaves the description alone when there are no comments', () => {
    expect(renderDescription('notes here', [])).toBe('notes here')
  })

  it('appends a marked block, oldest first', () => {
    const rendered = renderDescription('notes here', notes)

    expect(rendered).toContain(COMMENTS_MARKER)
    expect(rendered.indexOf('first')).toBeLessThan(rendered.indexOf('second'))
    expect(rendered).toContain('2026-08-09 · first')
  })

  it('renders a block alone when the task has no description', () => {
    expect(renderDescription('', notes).startsWith(COMMENTS_MARKER)).toBe(true)
  })

  it('round-trips back to the original description', () => {
    expect(stripCommentsBlock(renderDescription('notes here', notes))).toBe(
      'notes here',
    )
    expect(stripCommentsBlock(renderDescription('', notes))).toBe('')
  })

  it('is idempotent', () => {
    const once = stripCommentsBlock(renderDescription('notes here', notes))
    expect(stripCommentsBlock(once)).toBe(once)
  })

  it('leaves a description with no block untouched', () => {
    expect(stripCommentsBlock('just notes')).toBe('just notes')
  })

  // Google may hand back a reformatted description; the block must still be
  // recognisable afterwards or it leaks into the task.
  it('survives Google turning newlines into <br>', () => {
    const rendered = renderDescription('notes here', notes)
    const mangled = rendered.replace(/\n/g, '<br>')

    expect(stripCommentsBlock(normaliseGoogleText(mangled))).toBe('notes here')
  })
})

describe('normaliseGoogleText', () => {
  it('converts break tags to newlines', () => {
    expect(normaliseGoogleText('a<br>b<br />c<BR/>d')).toBe('a\nb\nc\nd')
  })

  it('decodes the entities Google escapes', () => {
    expect(normaliseGoogleText('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe(
      'a & b <c> "d"',
    )
  })

  it('is a no-op on plain text', () => {
    expect(normaliseGoogleText('plain text\nwith newline')).toBe(
      'plain text\nwith newline',
    )
  })
})

describe('notesDigest', () => {
  it('changes when a comment is added, edited, or removed', () => {
    const base = [{ content: 'first', postedAt: '2026-08-09T10:00:00Z' }]
    const added = [...base, { content: 'second', postedAt: '2026-08-10T11:00:00Z' }]
    const edited = [{ content: 'edited', postedAt: '2026-08-09T10:00:00Z' }]

    expect(notesDigest(base)).not.toBe(notesDigest(added))
    expect(notesDigest(base)).not.toBe(notesDigest(edited))
    expect(notesDigest([])).not.toBe(notesDigest(base))
  })

  it('is stable for the same comments', () => {
    const notes = [{ content: 'first', postedAt: '2026-08-09T10:00:00Z' }]
    expect(notesDigest(notes)).toBe(notesDigest([...notes]))
  })
})
