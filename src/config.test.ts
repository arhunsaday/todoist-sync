import { describe, expect, it } from 'vitest'

import { mappingsSchema } from './config.js'

describe('SYNC_MAPPINGS parsing', () => {
  it('parses the four pairs', () => {
    const result = mappingsSchema.parse(
      '2334567890:abc@group.calendar.google.com,' +
        '2334567891:def@group.calendar.google.com,' +
        '2334567892:ghi@group.calendar.google.com,' +
        '2334567893:personal@gmail.com',
    )

    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({
      todoistProjectId: '2334567890',
      googleCalendarId: 'abc@group.calendar.google.com',
    })
    expect(result[3]?.googleCalendarId).toBe('personal@gmail.com')
  })

  it('tolerates whitespace and a trailing comma', () => {
    const result = mappingsSchema.parse(' 123 : a@b.com , 456:c@d.com , ')

    expect(result).toEqual([
      { todoistProjectId: '123', googleCalendarId: 'a@b.com' },
      { todoistProjectId: '456', googleCalendarId: 'c@d.com' },
    ])
  })

  it('splits only on the first colon, so calendar ids stay intact', () => {
    const result = mappingsSchema.parse('123:weird:id@group.calendar.google.com')

    expect(result[0]?.googleCalendarId).toBe('weird:id@group.calendar.google.com')
  })

  it('rejects a pair with no colon', () => {
    expect(() => mappingsSchema.parse('123')).toThrow(
      /expected .*todoistProjectId:googleCalendarId/,
    )
  })

  it('rejects an empty mapping list', () => {
    expect(() => mappingsSchema.parse('')).toThrow()
  })

  // Both of these would make the direction of a change ambiguous at runtime.
  it('rejects the same Todoist project mapped twice', () => {
    expect(() => mappingsSchema.parse('123:a@b.com,123:c@d.com')).toThrow(
      /project 123 is mapped more than once/,
    )
  })

  it('rejects the same Google calendar targeted twice', () => {
    expect(() => mappingsSchema.parse('123:a@b.com,456:a@b.com')).toThrow(
      /calendar a@b.com is mapped more than once/,
    )
  })
})
