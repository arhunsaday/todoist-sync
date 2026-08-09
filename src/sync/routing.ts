import { getConfig, type Mapping } from '../config.js'

/**
 * The project↔calendar mapping, indexed both ways.
 *
 * The mapping is the boundary of the sync: a task in an unmapped project and
 * an event on an unmapped calendar are both invisible to it.
 */
export class Routing {
  private readonly calendarByProject: ReadonlyMap<string, string>
  private readonly projectByCalendar: ReadonlyMap<string, string>

  constructor(mappings: readonly Mapping[]) {
    this.calendarByProject = new Map(
      mappings.map((m) => [m.todoistProjectId, m.googleCalendarId]),
    )
    this.projectByCalendar = new Map(
      mappings.map((m) => [m.googleCalendarId, m.todoistProjectId]),
    )
  }

  static fromConfig(): Routing {
    return new Routing(getConfig().SYNC_MAPPINGS)
  }

  calendarForProject(projectId: string): string | undefined {
    return this.calendarByProject.get(projectId)
  }

  projectForCalendar(calendarId: string): string | undefined {
    return this.projectByCalendar.get(calendarId)
  }

  get calendarIds(): string[] {
    return [...this.projectByCalendar.keys()]
  }
}
