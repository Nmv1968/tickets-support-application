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
  /** A read is on its way, whoever asked for it. What the eye is shown of it: an icon that turns, `aria-busy`. */
  readonly loading: Signal<boolean>;
  /**
   * A read the person asked for is on its way: the first one (they opened the screen), one for
   * other params (a filter, the search, a page, the order, the period) or one of `refresh()`. Not
   * one of `reread()`, made for a change someone else made. What a screen says aloud of its
   * loading ("Actualizando…") goes by this one: an idle screen-reader user heard it each time
   * anyone saved a case.
   */
  readonly asked: Signal<boolean>;
  /**
   * Reads again, at once, because the person asked for it (the button "Actualizar"). Also while a
   * read is on its way: that one may have been taken before the change that asks for this one, so
   * it is cancelled and its answer is never shown.
   */
  refresh(): void;
  /** The same, for a change the person did not ask to see (a case saved here or elsewhere): in silence (see `asked`). */
  reread(): void;
}

/**
 * A read driven by signals: made again whenever what `params` reads changes, and when `refresh()`
 * or `reread()` asks for it (a case changed here or elsewhere). Only the answer to the latest read
 * counts: the one before is cancelled, through the signal `load` gives its request.
 *
 * Built on Angular's `resource()`, which is still experimental in Angular 20. It reads, cancels and
 * says when it is loading; three things are added. The answer is kept as it arrives, and stays on
 * screen while the next read is on its way: `resource` empties its own value as soon as its params
 * change. `refresh()` reads again also while a read is on its way, which `reload()` does not do.
 * And it tells a read the person asked for from one they did not (`asked`). A failure is passed to
 * `failed`, unless the read was cancelled; with `current` too.
 *
 * `load` is also given `current`: whether its read is still the one asked for last. A read is
 * cancelled only at the screen update after the change that asks for the next one, and can be
 * answered before it: what `load` does with its answer besides returning it waits for `current`.
 * Other params that `load` (or `failed`) sets right after `current` says yes are its own doing,
 * not the person's: the list going to the last page there is, after a page past its end. The read
 * they ask for is asked for as the one it follows was.
 */
export function liveResource<T, P = null>(options: {
  params?: () => P;
  load: (params: P, abort: AbortSignal, current: () => boolean) => Promise<T>;
  failed: (error: unknown, current: () => boolean) => void;
}): LiveResource<T> {
  // Kept as it was until what it reads changes: a refresh alone asks for the same params, the same object.
  const params = computed(options.params ?? ((): P => null as P));
  // Each refresh is another request to `resource`, which cancels the one on its way.
  const refreshes = signal(0);
  const request = computed(() => ({ params: params(), refreshes: refreshes() }));
  type Request = ReturnType<typeof request>;
  const value = signal<T | undefined>(undefined);

  // Who asked for the reads. Kept outside the signals: only `asking` is shown.
  /** `refresh()` was called since the last read started. */
  let refreshAsked = false;
  /** The request of the last read started. Other params than its own are the person's. */
  let last: Request | undefined;
  /** The request a read moved to by itself (see above), and whether the person had asked for that read. */
  let moved: { to: Request; asked: boolean } | undefined;
  /** A read the person asked for is on its way, or a read that took its place. The first one is theirs. */
  const asking = signal(true);

  const read = resource({
    params: request,
    loader: async ({ params: asked, abortSignal }) => {
      const followed = moved?.to === asked ? moved.asked : undefined;
      const byPerson = last === undefined || refreshAsked || (followed ?? asked.params !== last.params);
      last = asked;
      moved = undefined;
      refreshAsked = false;
      // One the person asked for and cancelled for this one is answered by this one: still said.
      const voice = byPerson || untracked(asking);
      asking.set(voice);

      // Unless another read was asked for meanwhile: `resource` drops this answer then too.
      const current = (): boolean => !abortSignal.aborted && untracked(request) === asked;
      // What `load` sets right after this says yes runs before anything the person can do: before
      // the next task. Seen at the end of that, other params are its own doing.
      const told = (): boolean => {
        const yes = current();
        if (yes)
          queueMicrotask(() => {
            const now = untracked(request);
            if (now !== asked) moved = { to: now, asked: voice };
          });
        return yes;
      };
      try {
        const answer = await options.load(asked.params, abortSignal, told);
        if (current()) {
          value.set(answer);
          asking.set(false);
        }
        return answer;
      } catch (error) {
        if (!abortSignal.aborted) {
          options.failed(error, told);
          if (current()) asking.set(false);
        }
        throw error;
      }
    },
  });
  return {
    value,
    loading: read.isLoading,
    asked: computed(() => read.isLoading() && asking()),
    refresh: () => {
      refreshAsked = true;
      refreshes.update((count) => count + 1);
    },
    reread: () => refreshes.update((count) => count + 1),
  };
}
