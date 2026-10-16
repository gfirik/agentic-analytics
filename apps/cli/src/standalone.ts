// What differs when the CLI runs as the standalone binary (`bun build --compile`, scripts/build-binary.ts sets
// AA_STANDALONE=1 before loading the CLI): no source tree next to it, no in-process ONNX embedder, no viewer build,
// and Bun's runtime instead of Node's. Pure functions, so the choices are tested without building a binary.
import { join } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

export const isStandalone = (env: Env): boolean => env.AA_STANDALONE === "1";

/**
 * Where `aa eval` writes results, and its RESULTS.md page: the flag's folder (page inside it), else evals/results
 * with evals/RESULTS.md in a source checkout, else ./eval-results (page inside it) in the binary. The page never lands
 * in a folder the user didn't name.
 */
export function resultsLocation(
  arg: string | undefined,
  env: Env,
  cwd: string,
  checkoutDefault: string,
): { readonly dir: string; readonly page?: string } {
  if (arg) return { dir: arg, page: join(arg, "RESULTS.md") };
  if (isStandalone(env)) {
    const dir = join(cwd, "eval-results");
    return { dir, page: join(dir, "RESULTS.md") };
  }
  return { dir: checkoutDefault };
}

/**
 * The embedder to build: "hash" when asked for, or by default in the binary (Transformers.js needs the sharp and
 * onnxruntime native libraries, which the binary doesn't carry); otherwise the named or configured ONNX model.
 */
export function embedderChoice(
  arg: string | undefined,
  env: Env,
): { readonly kind: "hash"; readonly notice?: string } | { readonly kind: "onnx"; readonly model?: string } {
  if (arg === "hash") return { kind: "hash" };
  if (!arg && isStandalone(env))
    return {
      kind: "hash",
      notice:
        "Standalone binary: documents are indexed with the offline hash embedder (lexical). For semantic retrieval use the Docker image or the Node CLI.",
    };
  return arg ? { kind: "onnx", model: arg } : { kind: "onnx" };
}

/** The runtime line for `aa doctor`: Node's version, and Bun's when the binary runs on it. */
export function runtimeVersion(env: Env, versions: Readonly<Record<string, string | undefined>>, nodeVersion: string): string {
  return isStandalone(env) && versions.bun ? `${nodeVersion} (Node API of the Bun ${versions.bun} runtime)` : nodeVersion;
}
