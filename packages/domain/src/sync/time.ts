import type { Schedule } from '../types'
export function toEventSchedule(s: Schedule): {
  start: { date?: string | null; dateTime?: string | null; timeZone?: string | null }
  end: { date?: string | null; dateTime?: string | null; timeZone?: string | null }
} {
  if (!s) throw new Error('Une date est nécessaire pour créer un événement.')
  if (s.kind === 'date') {
    const start = new Date(s.date + 'T00:00:00Z')
    if (start.toISOString().slice(0, 10) !== s.date) throw new Error('Date invalide')
    start.setUTCDate(start.getUTCDate() + s.days)
    return {
      start: { date: s.date, dateTime: null, timeZone: null },
      end: { date: start.toISOString().slice(0, 10), dateTime: null, timeZone: null },
    }
  }
  if (!/(Z|[+-]\d\d:\d\d)$/.test(s.start))
    throw new Error('Une heure absolue est requise. Vérifiez le fuseau horaire.')
  const start = new Date(s.start)
  return {
    start: { date: null, dateTime: start.toISOString(), timeZone: s.timeZone },
    end: {
      date: null,
      dateTime: new Date(start.getTime() + s.durationMinutes * 60000).toISOString(),
      timeZone: s.timeZone,
    },
  }
}
