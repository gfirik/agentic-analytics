// The job event bus (ARCHITECTURE §2, interfaces spec §1): every stage emits progress events. Events are
// validated against the schema, numbered, stored in the job's `events` table, and pushed to listeners (the
// CLI's live view, the server's SSE stream).
import { JobEvent } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";

type Distribute<T> = T extends unknown ? Omit<T, "job_id" | "seq" | "at"> : never;
/** An event as a stage emits it; the bus adds the job id, sequence number and timestamp. */
export type EventInput = Distribute<JobEvent>;

export class EventBus {
  private readonly listeners = new Set<(e: JobEvent) => void>();
  private seq = 0;

  private constructor(
    private readonly ws: Workspace,
    readonly jobId: string,
    private readonly now: () => Date,
  ) {}

  /** Continues the sequence of events already stored, so a resumed job appends rather than overwrites. */
  static async open(ws: Workspace, jobId: string, now: () => Date = () => new Date()): Promise<EventBus> {
    const bus = new EventBus(ws, jobId, now);
    const last = await ws.one<{ n: number | null }>(sql`SELECT max(seq) AS n FROM events WHERE job_id = ${jobId}`);
    bus.seq = (last?.n ?? -1) + 1;
    return bus;
  }

  subscribe(listener: (e: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(input: EventInput): Promise<JobEvent> {
    const event = JobEvent.parse({ ...input, job_id: this.jobId, seq: this.seq++, at: this.now().toISOString() });
    const { job_id, seq, at, type, ...payload } = event;
    await this.ws.run(
      sql`INSERT INTO events VALUES (${seq}, ${job_id}, ${at}::TIMESTAMPTZ::TIMESTAMP, ${type}, ${JSON.stringify(payload)}::JSON)`,
    );
    for (const l of this.listeners) l(event);
    return event;
  }

  /** All stored events of this job, in order. */
  async history(): Promise<JobEvent[]> {
    const rows = await this.ws.all<{ seq: number; type: string; at: string; payload: string }>(
      sql`SELECT seq, type, strftime(occurred_at, '%Y-%m-%dT%H:%M:%S.%gZ') AS at, payload::VARCHAR AS payload
          FROM events WHERE job_id = ${this.jobId} ORDER BY seq`,
    );
    return rows.map((r) =>
      JobEvent.parse({ ...(JSON.parse(r.payload) as object), job_id: this.jobId, seq: r.seq, at: r.at, type: r.type }),
    );
  }
}
