import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { env } from '../config/env';
import { buildRedisConnection } from '../queues/queue-names';

/** Tutor requests waiting on the model: member = request id, score = expiry (ms). */
const INTERACTIVE_KEY = 'llm:interactive';
/** Set by the worker while a background generation call holds the model. */
const BACKGROUND_KEY = 'llm:background-busy';
/** A claim lives this long without a heartbeat (covers a crashed API process). */
const CLAIM_TTL_MS = 30_000;
const HEARTBEAT_MS = 10_000;
/** How often an in-flight background call checks whether a student is waiting. */
const PREEMPT_POLL_MS = 1_000;
const RESUME_POLL_MS = 2_000;

class PreemptedForTutor extends Error {
  constructor() {
    super('Background model call cancelled: a tutor question has priority');
  }
}

/**
 * One local model serves both the interactive tutor and background generation, and it
 * handles one request at a time. A tutor question that queued behind a generation call
 * would wait the whole call (5-7 minutes on CPU). Instead the tutor claims priority: the
 * worker cancels its in-flight call (the model server stops on disconnect within seconds),
 * waits until no student is waiting, then repeats the call. Only that one call is redone;
 * finished batches are already saved.
 *
 * Coordination is through Redis because the API and the worker are separate processes.
 * Redis trouble never blocks a tutor answer: the claim is best-effort.
 */
@Injectable()
export class ModelPriorityService implements OnModuleDestroy {
  private readonly logger = new Logger(ModelPriorityService.name);
  private redis?: Redis;

  private client(): Redis {
    this.redis ??= new Redis({ ...buildRedisConnection(), lazyConnect: true, maxRetriesPerRequest: 2 });
    return this.redis;
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  /** API side: marks a tutor request as waiting on the model. Call the returned function when done. */
  async claim(): Promise<() => Promise<void>> {
    if (!env.TUTOR_PRIORITY) return async () => undefined;
    const id = randomUUID();
    const refresh = () => this.client().zadd(INTERACTIVE_KEY, Date.now() + CLAIM_TTL_MS, id);
    try {
      await refresh();
    } catch (error) {
      this.logger.warn(`Could not claim model priority: ${error}`);
      return async () => undefined;
    }
    const heartbeat = setInterval(() => void refresh().catch(() => undefined), HEARTBEAT_MS);
    return async () => {
      clearInterval(heartbeat);
      await this.client().zrem(INTERACTIVE_KEY, id).catch(() => undefined);
    };
  }

  /** API side: whether a background generation call is holding the model right now. */
  async backgroundBusy(): Promise<boolean> {
    if (!env.TUTOR_PRIORITY) return false;
    try {
      return (await this.client().exists(BACKGROUND_KEY)) === 1;
    } catch {
      return false;
    }
  }

  private async interactiveWaiting(): Promise<boolean> {
    try {
      const now = Date.now();
      await this.client().zremrangebyscore(INTERACTIVE_KEY, '-inf', now); // expired claims
      return (await this.client().zcount(INTERACTIVE_KEY, now, '+inf')) > 0;
    } catch {
      return false; // Redis trouble must not stall generation forever
    }
  }

  /**
   * Worker side: runs a background model call that steps aside whenever a student is waiting.
   * `call` must pass the signal to the model request so cancelling it frees the model.
   */
  async runPreemptible<T>(label: string, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!env.TUTOR_PRIORITY) return call(new AbortController().signal);
    for (;;) {
      await this.waitForInteractiveToFinish(label);

      const controller = new AbortController();
      const markBusy = () => this.client().set(BACKGROUND_KEY, label, 'PX', CLAIM_TTL_MS).catch(() => undefined);
      await markBusy();
      const busyHeartbeat = setInterval(() => void markBusy(), HEARTBEAT_MS);
      const watcher = setInterval(() => {
        void this.interactiveWaiting().then((waiting) => {
          if (waiting && !controller.signal.aborted) controller.abort(new PreemptedForTutor());
        });
      }, PREEMPT_POLL_MS);

      try {
        return await call(controller.signal);
      } catch (error) {
        if (!(controller.signal.reason instanceof PreemptedForTutor)) throw error;
        this.logger.log(`${label}: paused so a tutor question can use the model; will repeat this step`);
      } finally {
        clearInterval(watcher);
        clearInterval(busyHeartbeat);
        await this.client().del(BACKGROUND_KEY).catch(() => undefined);
      }
    }
  }

  private async waitForInteractiveToFinish(label: string) {
    let logged = false;
    while (await this.interactiveWaiting()) {
      if (!logged) this.logger.log(`${label}: waiting while a tutor question uses the model`);
      logged = true;
      await new Promise((resolve) => setTimeout(resolve, RESUME_POLL_MS));
    }
  }
}
