// The data behind the Learn section (docs/DOCS-SITE.md §1, apps/docs/scripts/learn-data.ts): everything a Learn page
// shows, recorded from real engine runs on examples/coffee-roaster and checked in at docs/assets/learn/learn.json.
// A test regenerates it and fails on drift (scripts/test/learn.test.ts).

/** A fact as the engine stored it: its id, value, unit and computation. Formatting happens on the page. */
export interface LearnFact {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly currency: string | null;
  /** True when the verifier recomputed it (V2) and it is in the verified report. */
  readonly verified: boolean;
  readonly computation: {
    readonly kind: "sql" | "function";
    readonly sql?: string;
    readonly params?: unknown;
    readonly fn?: string;
    readonly inputs?: readonly string[];
  };
}

/** One item going into or out of a stage. `fact` points at a LearnFact; `value` is a count or a name. */
export interface FlowItem {
  readonly label: string;
  readonly value?: string;
  readonly fact?: string;
  readonly note?: string;
}

/** A stage as an in → out diagram, stepped through. */
export interface Flow {
  readonly stage: string;
  readonly inputs: readonly FlowItem[];
  readonly steps: readonly { readonly label: string; readonly detail: string; readonly outputs: readonly number[] }[];
  readonly outputs: readonly FlowItem[];
  /** Where the numbers come from, in a few words. */
  readonly source: string;
}

export interface Transcript {
  /** The command as a reader types it (checked against the CLI by scripts/test/site-commands.test.ts). */
  readonly command: string;
  readonly lines: readonly string[];
  /** What was normalised in the recorded output (durations, job ids, paths), said on the page. */
  readonly normalised: readonly string[];
}

export interface LearnData {
  readonly run: {
    readonly example: string;
    readonly model: string;
    readonly web: string;
    readonly embedder: string;
    readonly today: string;
    readonly stages: readonly string[];
    readonly events: number;
  };
  readonly facts: Readonly<Record<string, LearnFact>>;
  readonly flows: Readonly<Record<string, Flow>>;
  readonly ingest: {
    readonly files: readonly { readonly id: string; readonly name: string; readonly kind: string; readonly bytes: number }[];
    readonly tables: readonly {
      readonly id: string;
      readonly file: string;
      readonly sheet: string;
      readonly range: string;
      readonly rows: number;
      readonly columns: readonly { readonly letter: string; readonly name: string; readonly label: string; readonly type: string }[];
      readonly dateColumn: string | null;
      readonly first: string | null;
      readonly last: string | null;
      readonly grain: string | null;
      readonly key: readonly string[];
    }[];
    readonly sections: readonly {
      readonly id: string;
      readonly file: string;
      readonly kind: string;
      readonly where: string;
      readonly chars: number;
    }[];
    readonly quality: readonly {
      readonly id: string;
      readonly kind: string;
      readonly severity: string;
      readonly message: string;
      readonly where: string;
    }[];
    readonly entities: {
      readonly count: number;
      readonly merged: readonly { readonly raw: string; readonly canonical: string; readonly confidence: number; readonly rows: number }[];
    };
  };
  readonly metrics: {
    readonly defs: readonly { readonly id: string; readonly label: string; readonly status: string; readonly yaml: string }[];
    readonly revenue: {
      readonly sql: string;
      readonly params: unknown;
      readonly series: readonly { readonly period: string; readonly fact: string }[];
    };
  };
  readonly analysis: {
    readonly change: { readonly before: string; readonly after: string; readonly delta: string; readonly pct: string };
    readonly noise: {
      readonly z: string;
      readonly threshold: number;
      readonly band: number;
      readonly shift: string;
      readonly template: string;
    };
    readonly channel: readonly { readonly member: string; readonly delta: string; readonly share: string }[];
    readonly channelTotal: string;
    readonly pvm: { readonly volume: string; readonly mix: string; readonly price: string; readonly total: string };
    readonly templates: readonly { readonly id: string; readonly template: string; readonly metric: string; readonly period: string }[];
    readonly real: readonly {
      readonly dataset: string;
      readonly title: string;
      readonly check: string;
      readonly about: string;
      readonly pass: boolean;
      readonly detail: string;
    }[];
    readonly realFile: string;
  };
  readonly retrieval: {
    readonly query: string;
    readonly embedder: string;
    readonly stemmer: string;
    readonly chunks: number;
    readonly degraded: readonly string[];
    readonly hits: readonly {
      readonly chunk: string;
      readonly source: string;
      readonly file: string;
      readonly heading: string;
      readonly text: string;
      readonly bm25: number | null;
      readonly vector: number | null;
      readonly rrf: number;
    }[];
    readonly extract: unknown;
  };
  readonly web: {
    readonly asked: string;
    readonly sent: string;
    readonly removed: readonly { readonly kind: string; readonly text: string }[];
    readonly results: readonly { readonly url: string; readonly outcome: "kept" | "quarantined" | "refused"; readonly why: string }[];
    readonly statement: { readonly source: string; readonly quote: string; readonly url: string } | null;
    readonly gap: string | null;
  };
  readonly agent: {
    readonly tools: readonly string[];
    readonly finding: string;
    readonly calls: readonly { readonly step: number; readonly tool: string; readonly input: unknown; readonly output: string }[];
    readonly structured: { readonly role: string; readonly schema: string; readonly object: unknown } | null;
    readonly roles: Readonly<Record<string, number>>;
  };
  readonly verifier: {
    readonly checks: readonly { readonly check: string; readonly name: string; readonly run: number; readonly failed: number }[];
    readonly dropped: readonly { readonly claim: string; readonly reason: string }[];
    readonly downgraded: readonly { readonly claim: string; readonly from: string; readonly to: string; readonly reason: string }[];
    readonly summary: {
      readonly numbers_checked: number;
      readonly numbers_mismatched: number;
      readonly citations_checked: number;
      readonly claims_shipped: number;
    };
  };
  readonly report: {
    readonly headline: string;
    readonly finding: {
      readonly id: string;
      readonly title: string;
      readonly claims: readonly {
        readonly text: string;
        readonly facts: readonly string[];
        readonly grade: string | null;
        readonly citations: readonly {
          readonly source: string;
          readonly file: string;
          readonly quote: string | null;
          readonly rows: number;
        }[];
      }[];
    };
    readonly action: { readonly id: string; readonly text: string; readonly low: string; readonly high: string; readonly horizon: string };
    readonly facts: number;
  };
  readonly router: {
    readonly spec: string;
    readonly calls: readonly {
      readonly role: string;
      readonly provider: string;
      readonly endpoint: string | null;
      readonly model: string;
      readonly status: number;
      readonly cached: boolean;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly error: string | null;
    }[];
    readonly answer: unknown;
  };
  readonly security: {
    readonly quarantined: readonly { readonly source: string; readonly url: string; readonly reason: string }[];
    /** How many fixtures the injection suite has. */
    readonly fixtures: number;
    readonly screen: readonly { readonly source: string; readonly text: string; readonly flagged: boolean }[];
    readonly ssrf: readonly { readonly url: string; readonly code: string; readonly message: string }[];
    readonly injectionRun: {
      readonly fixture: string;
      readonly file: string;
      readonly flagged: readonly { readonly kind: string; readonly description: string }[];
      readonly sameFacts: boolean;
      readonly phraseInReport: boolean;
    };
  };
  readonly transcripts: Readonly<Record<string, Transcript>>;
  readonly tutorials: {
    /** The YAML `aa metrics --save` wrote. */
    readonly metricsYaml: string;
    readonly evidence: {
      readonly without: {
        readonly claims: readonly { readonly text: string; readonly grade: string | null; readonly sources: readonly string[] }[];
        readonly title: string;
      };
      readonly with: {
        readonly claims: readonly { readonly text: string; readonly grade: string | null; readonly sources: readonly string[] }[];
        readonly title: string;
      };
    };
    readonly mcp: {
      readonly tools: readonly { readonly name: string; readonly description: string }[];
      readonly calls: readonly { readonly tool: string; readonly args: unknown; readonly result: string }[];
    };
  };
}
