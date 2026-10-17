export type ModelErrorCode =
  | "CONFIG" // invalid or incomplete model configuration
  | "MISSING_KEY" // an api_key_env is named but not set
  | "INVALID_OUTPUT" // structured output failed validation after all retries
  | "PROVIDER" // the provider returned an error or was unreachable
  | "TIMEOUT"
  | "INPUT_TOO_LARGE" // the estimated input is over the call's maxInputTokens; refused before sending
  | "RATE_LIMITED" // every route of the model is rate-limited past the wait cap; never switches models
  | "NOT_AVAILABLE" // capability lands in a later milestone
  | "FAKE_NO_SCRIPT"; // FakeModel had no scripted response for a call

export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ModelError";
  }
}
