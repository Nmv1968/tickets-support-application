import { DestroyRef, computed, inject, resource, signal, untracked } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';

/*
 * How the screens read what they show from the server, when the same read is asked for again and
 * again and only the latest answer counts: an older one can arrive after it.
 */

/** One of the turns of a `Latest`. */
export interface Turn {
  /** Aborted once a newer turn starts: given to a read (see Api), it cancels its request. */
  readonly signal: AbortSignal;
  /** No newer turn has started: what this one asked for is still wanted. */
  current(): boolean;
}

/**
 * The turns of something done again and again in steps of its own, of which only the latest
 * counts: a read of a case, the preview of a sheet, the form on screen. `next()` starts a turn
 * and leaves the one before behind.
 *
 * Never give the signal of a turn to a write: cancelled on its way, it may be stored all the
 * same, and nobody would hear of it.
 */
export class Latest {
  private count = 0;
  private controller = new AbortController();

  /** Starts a turn. The one before is no longer current, and its signal is aborted. */
  next(): Turn {
    this.end();
    return this.now();
  }

  /** The turn on now, for what is asked for under it and has to know, once answered, whether it still is. */
  now(): Turn {
    const count = this.count;
    return { signal: this.controller.signal, current: () => count === this.count };
  }

  /** Leaves the turn on now behind, with no new one. */
  end(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.count++;
  }
}

/** A `Latest` whose last turn ends with the screen that has it: nothing is asked for a screen that is gone. */
export function latest(): Latest {
  const turns = new Latest();
  inject(DestroyRef).onDestroy(() => turns.end());
  return turns;
}

/** What a screen shows of a `liveResource`. */
export interface LiveResource<T> {
  /**
   * The latest answer, or what the screen made of it since (a row replaced with the case as it was
   * saved). Undefined only until the first answer: while the next read is on its way, and after
   * one that failed, the screen keeps what it had.
   */
  readonly value: WritableSignal<T | undefined>;
  /** A read is on its way. */
  readonly loading: Signal<boolean>;
  /**
   * Reads again, at once. Also while a read is on its way: that one may have been taken before the
   * change that asks for this one, so it is cancelled and its answer is never shown.
   */
  refresh(): void;
}

/**
 * A read driven by signals: made again whenever what `params` reads changes, and when `refresh()`
 * asks for it (a case changed here or elsewhere). Only the answer to the latest read counts: the
 * one before is cancelled, through the signal `load` gives its request.
 *
 * Built on Angular's `resource()`, which is still experimental in Angular 20. It reads, cancels and
 * says when it is loading; two things are added. The answer is kept as it arrives, and stays on
 * screen while the next read is on its way: `resource` empties its own value as soon as its params
 * change. And `refresh()` reads again also while a read is on its way, which `reload()` does not
 * do. A failure is passed to `failed`, unless the read was cancelled; with `current` too.
 *
 * `load` is also given `current`: whether its read is still the one asked for last. A read is
 * cancelled only at the screen update after the change that asks for the next one, and can be
 * answered before it: what `load` does with its answer besides returning it waits for `current`.
 */
export function liveResource<T, P = null>(options: {
  params?: () => P;
  load: (params: P, abort: AbortSignal, current: () => boolean) => Promise<T>;
  failed: (error: unknown, current: () => boolean) => void;
}): LiveResource<T> {
  const params = options.params ?? ((): P => null as P);
  // Each refresh is another request to `resource`, which cancels the one on its way.
  const refreshes = signal(0);
  const request = computed(() => ({ params: params(), refreshes: refreshes() }));
  const value = signal<T | undefined>(undefined);
  const read = resource({
    params: request,
    loader: async ({ params: asked, abortSignal }) => {
      // Unless another read was asked for meanwhile: `resource` drops this answer then too.
      const current = (): boolean => !abortSignal.aborted && untracked(request) === asked;
      try {
        const answer = await options.load(asked.params, abortSignal, current);
        if (current()) value.set(answer);
        return answer;
      } catch (error) {
        if (!abortSignal.aborted) options.failed(error, current);
        throw error;
      }
    },
  });
  return { value, loading: read.isLoading, refresh: () => refreshes.update((count) => count + 1) };
}
