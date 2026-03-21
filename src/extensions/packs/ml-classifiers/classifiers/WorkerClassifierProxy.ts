/**
 * @fileoverview WorkerClassifierProxy — wraps an IContentClassifier to run
 * inference inside a Web Worker, with automatic main-thread fallback.
 *
 * ## Why a proxy?
 * ML inference (even quantized ONNX / WASM pipelines) can block the main
 * thread for 50–500 ms per classification.  Moving classification into a
 * Web Worker keeps the UI responsive.  This proxy makes the switch
 * transparent to callers: they still call `classify(text)` and receive a
 * `ClassificationResult`; the underlying transport (Worker vs. direct call)
 * is an implementation detail.
 *
 * ## Fallback policy
 * The proxy falls back to direct (main-thread) delegation whenever:
 *  - The global `Worker` constructor is undefined (Node.js, older browsers).
 *  - `browserConfig.useWebWorker` is explicitly `false`.
 *  - Worker creation throws (e.g. strict CSP that blocks `blob:` URLs).
 *
 * Once a fallback has been triggered by a Worker creation error the proxy
 * sets `workerFailed = true` and remains in fallback mode for all subsequent
 * calls.
 *
 * ## IContentClassifier contract
 * The proxy forwards all identity fields (`id`, `displayName`, `description`,
 * `modelId`) and the `isLoaded` state directly from the wrapped classifier so
 * it is completely transparent to the orchestrator.
 *
 * @module agentos/extensions/packs/ml-classifiers/classifiers/WorkerClassifierProxy
 */

import type { ClassificationResult } from '../../../../core/ai_utilities/IUtilityAI';
import type { IContentClassifier } from '../IContentClassifier';
import type { BrowserConfig } from '../types';

// ---------------------------------------------------------------------------
// Internal message shapes
// ---------------------------------------------------------------------------

/**
 * Message sent from the main thread to the Worker to request classification.
 *
 * @internal
 */
interface WorkerClassifyRequest {
  /** Discriminant tag that identifies this message type. */
  type: 'classify';

  /** The text to classify.  Passed directly to the pipeline. */
  text: string;

  /** Hugging Face model ID (or local path) to load if not yet cached. */
  modelId: string;

  /**
   * Whether to request a quantized model variant.
   * Passed through to the `@huggingface/transformers` pipeline factory.
   */
  quantized: boolean;

  /**
   * HuggingFace pipeline task string, e.g. `'text-classification'`.
   * Sent so the Worker can use the correct pipeline type when loading the
   * model for the first time.
   */
  taskType: string;
}

/**
 * Success response posted back from the Worker.
 *
 * @internal
 */
interface WorkerResultMessage {
  /** Discriminant tag. */
  type: 'result';

  /** The resolved classification result. */
  result: ClassificationResult;
}

/**
 * Error response posted back from the Worker.
 *
 * @internal
 */
interface WorkerErrorMessage {
  /** Discriminant tag. */
  type: 'error';

  /** Human-readable error message. */
  error: string;
}

/** Union of all possible messages coming back from the Worker. */
type WorkerResponse = WorkerResultMessage | WorkerErrorMessage;

// ---------------------------------------------------------------------------
// WorkerClassifierProxy
// ---------------------------------------------------------------------------

/**
 * Transparent proxy around an {@link IContentClassifier} that offloads
 * `classify()` calls to a Web Worker when the browser environment supports it.
 *
 * In all other environments (Node.js, strict CSP, explicit opt-out) the proxy
 * delegates calls directly to the wrapped classifier on the main thread.
 *
 * @implements {IContentClassifier}
 *
 * @example Browser context — Web Worker path
 * ```typescript
 * const toxicity = new ToxicityClassifier(serviceRegistry);
 * const proxy = new WorkerClassifierProxy(toxicity, { useWebWorker: true });
 * const result = await proxy.classify('some text');
 * ```
 *
 * @example Node.js / forced fallback path
 * ```typescript
 * const proxy = new WorkerClassifierProxy(toxicity, { useWebWorker: false });
 * // Delegates directly to toxicity.classify() on the same thread.
 * ```
 */
export class WorkerClassifierProxy implements IContentClassifier {
  // -------------------------------------------------------------------------
  // IContentClassifier identity — delegated from wrapped classifier
  // -------------------------------------------------------------------------

  /**
   * {@inheritDoc IContentClassifier.id}
   * Delegated from the wrapped classifier so this proxy is transparent in
   * the orchestrator's service-ID lookups.
   */
  get id(): string {
    return this.wrapped.id;
  }

  /**
   * {@inheritDoc IContentClassifier.displayName}
   * Returns the wrapped classifier's display name with a `(Worker)` suffix
   * when the Web Worker path is active, so logs clearly indicate the mode.
   */
  get displayName(): string {
    return this.wrapped.displayName;
  }

  /**
   * {@inheritDoc IContentClassifier.description}
   * Delegated directly from the wrapped classifier.
   */
  get description(): string {
    return this.wrapped.description;
  }

  /**
   * {@inheritDoc IContentClassifier.modelId}
   * Delegated directly from the wrapped classifier.
   */
  get modelId(): string {
    return this.wrapped.modelId;
  }

  /**
   * {@inheritDoc IContentClassifier.isLoaded}
   *
   * Reflects the wrapped classifier's `isLoaded` state.  The wrapped
   * instance is the authoritative source because it owns the model weights
   * (whether they live in the Worker or on the main thread).
   */
  get isLoaded(): boolean {
    return this.wrapped.isLoaded;
  }

  /**
   * IContentClassifier requires `isLoaded` to be settable via the interface
   * contract (`isLoaded: boolean`).  We store the value through the wrapped
   * classifier so the authoritative state lives in one place.
   */
  set isLoaded(value: boolean) {
    this.wrapped.isLoaded = value;
  }

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /**
   * Set to `true` after a Worker creation failure.  Once set, all subsequent
   * `classify()` calls are routed directly to the wrapped classifier without
   * attempting to re-create the Worker.
   */
  private workerFailed = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a WorkerClassifierProxy.
   *
   * @param wrapped       - The real classifier to delegate to.  In Worker
   *                        mode this classifier is still responsible for
   *                        model loading and inference; the proxy just
   *                        changes the thread on which it executes.
   * @param browserConfig - Optional browser-side configuration.  Controls
   *                        whether Worker mode is attempted
   *                        (`useWebWorker`, default `true`).
   */
  constructor(
    private readonly wrapped: IContentClassifier,
    private readonly browserConfig?: BrowserConfig,
  ) {}

  // -------------------------------------------------------------------------
  // classify
  // -------------------------------------------------------------------------

  /**
   * Classify the provided text, routing to a Web Worker when available.
   *
   * ### Routing decision (evaluated once per call)
   * 1. `typeof Worker === 'undefined'` → fallback (Node.js / no Worker API).
   * 2. `browserConfig.useWebWorker === false` → fallback (explicit opt-out).
   * 3. `workerFailed === true` → fallback (previous Worker creation error).
   * 4. Otherwise → attempt to run in a Web Worker.
   *
   * If the Worker is created but fails to post a result within the
   * classification request, the error is propagated as a rejected promise
   * (not silently swallowed) so the orchestrator can log and fall back at
   * a higher level.
   *
   * @param text - The text to classify.  Must not be empty.
   * @returns A promise that resolves with the classification result.
   */
  async classify(text: string): Promise<ClassificationResult> {
    // Determine whether to use a Web Worker.
    const shouldUseWorker = this.shouldUseWebWorker();

    if (!shouldUseWorker) {
      // Fallback: delegate directly to the wrapped classifier on this thread.
      return this.wrapped.classify(text);
    }

    // Attempt to classify in a Worker.
    return this.classifyInWorker(text);
  }

  // -------------------------------------------------------------------------
  // dispose (optional IContentClassifier lifecycle hook)
  // -------------------------------------------------------------------------

  /**
   * Release resources held by the wrapped classifier.
   *
   * Delegates to `wrapped.dispose()` if it exists.  Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.wrapped.dispose) {
      await this.wrapped.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Determine whether the current environment and configuration support
   * running inference in a Web Worker.
   *
   * @returns `true` when Web Worker mode should be attempted.
   */
  private shouldUseWebWorker(): boolean {
    // Worker API is not available (Node.js, JSDOM without worker support, etc.)
    if (typeof Worker === 'undefined') {
      return false;
    }

    // Caller explicitly opted out of Web Worker mode.
    if (this.browserConfig?.useWebWorker === false) {
      return false;
    }

    // A previous Worker creation attempt failed — stay on main thread.
    if (this.workerFailed) {
      return false;
    }

    return true;
  }

  /**
   * Run `classify(text)` inside a transient Web Worker.
   *
   * Each call creates a new Worker, sends a single `classify` message,
   * awaits the `result` or `error` response, then terminates the Worker.
   *
   * If Worker creation itself throws (e.g. CSP violation), `workerFailed`
   * is set to `true` and the call falls back to the wrapped classifier on
   * the main thread.
   *
   * @param text - The text to classify inside the Worker.
   * @returns A promise resolving with the {@link ClassificationResult}.
   */
  private async classifyInWorker(text: string): Promise<ClassificationResult> {
    let worker: Worker;

    try {
      // Resolve the Worker script URL.  We use the sibling classifier-worker
      // module.  In a bundled environment this will be a blob URL or a
      // `new URL(...)` import; here we use a relative path that bundlers
      // understand via the standard Worker constructor pattern.
      worker = new Worker(new URL('../worker/classifier-worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      // Worker could not be created (CSP, missing support, etc.).
      // Mark as failed and fall back to the main thread.
      this.workerFailed = true;
      console.warn(
        `[WorkerClassifierProxy] Worker creation failed for "${this.wrapped.id}"; ` +
          `falling back to main-thread classification. Reason: ${err}`,
      );
      return this.wrapped.classify(text);
    }

    // Build the request message.
    const request: WorkerClassifyRequest = {
      type: 'classify',
      text,
      modelId: this.wrapped.modelId,
      // Default to non-quantized; the wrapped classifier's config owns this,
      // but the Worker needs it to load the right model variant.
      quantized: false,
      taskType: 'text-classification',
    };

    return new Promise<ClassificationResult>((resolve, reject) => {
      // Handle the single response message from the Worker.
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;

        if (message.type === 'result') {
          resolve(message.result);
        } else {
          reject(new Error(`Worker classification error: ${message.error}`));
        }

        // Terminate the Worker after receiving its response to free resources.
        worker.terminate();
      };

      // Handle any uncaught errors thrown inside the Worker.
      worker.onerror = (errorEvent: ErrorEvent) => {
        reject(
          new Error(
            `Worker runtime error in "${this.wrapped.id}": ${errorEvent.message}`,
          ),
        );
        worker.terminate();
      };

      // Send the classify request to the Worker.
      worker.postMessage(request);
    });
  }
}
