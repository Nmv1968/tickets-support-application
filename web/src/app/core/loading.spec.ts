import { EnvironmentInjector, createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { nextTask } from '../testing/screen';
import { Latest, latest, liveResource } from './loading';
import type { LiveResource } from './loading';

describe('Latest', () => {
  it('starts a turn that is current until the next one starts', () => {
    const turns = new Latest();
    const first = turns.next();
    expect(first.current()).toBeTrue();

    const second = turns.next();
    expect(first.current()).toBeFalse();
    expect(second.current()).toBeTrue();
  });

  it('aborts the signal of a turn once the next one starts, and not before', () => {
    const turns = new Latest();
    const first = turns.next();
    expect(first.signal.aborted).toBeFalse();

    const second = turns.next();
    expect(first.signal.aborted).toBeTrue();
    expect(second.signal.aborted).toBeFalse();
  });

  it('gives what is asked for now the turn on now, which a new turn leaves behind', () => {
    const turns = new Latest();
    const started = turns.next();
    const now = turns.now();
    expect(now.current()).toBeTrue();
    expect(now.signal).toBe(started.signal);

    turns.next();
    expect(now.current()).toBeFalse();
    expect(now.signal.aborted).toBeTrue();
  });

  it('ends the turn on now with no new one', () => {
    const turns = new Latest();
    const turn = turns.next();
    turns.end();
    expect(turn.current()).toBeFalse();
    expect(turn.signal.aborted).toBeTrue();
  });

  it('made with latest(), ends its last turn when the screen that has it goes away', () => {
    const screen = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const turns = runInInjectionContext(screen, () => latest());
    const turn = turns.next();

    screen.destroy();
    expect(turn.current()).toBeFalse();
    expect(turn.signal.aborted).toBeTrue();
  });
});

describe('liveResource', () => {
  /** A read that `load` was asked for, answered when the test says. */
  interface Read {
    params: string;
    abort: AbortSignal;
    answer(value: string): void;
    fail(error: unknown): void;
  }

  let reads: Read[];
  let failures: unknown[];
  const params = signal('enero');

  /** A read that is never answered. */
  const unanswered = (_: unknown, abort: AbortSignal): Promise<string> =>
    new Promise<string>(() => {
      reads.push({ params: '', abort, answer: () => undefined, fail: () => undefined });
    });

  function create(): LiveResource<string> {
    const created = TestBed.runInInjectionContext(() =>
      liveResource({
        params,
        load: (asked: string, abort: AbortSignal) =>
          new Promise<string>((resolve, reject) => reads.push({ params: asked, abort, answer: resolve, fail: reject })),
        failed: (error) => failures.push(error),
      }),
    );
    // Reads start with the effects, as they run on a screen update.
    TestBed.tick();
    return created;
  }

  /** Lets an answer, and what Angular does with it, run. */
  async function settle(): Promise<void> {
    await nextTask();
    TestBed.tick();
  }

  /** The next task of the browser after its next frame. */
  const afterNextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

  beforeEach(() => {
    reads = [];
    failures = [];
    params.set('enero');
  });

  it('reads with its params, and says it is loading until the answer arrives', async () => {
    const live = create();
    expect(reads.map((read) => read.params)).toEqual(['enero']);
    expect(live.loading()).toBeTrue();
    expect(live.value()).toBeUndefined();

    reads[0].answer('casos de enero');
    await settle();
    expect(live.loading()).toBeFalse();
    expect(live.value()).toBe('casos de enero');
  });

  // Also an answer nobody has looked at yet: it is kept as it arrives.
  it('reads again when its params change, and keeps what it had on screen meanwhile', async () => {
    const live = create();
    reads[0].answer('casos de enero');
    await settle();

    params.set('febrero');
    TestBed.tick();
    expect(reads.map((read) => read.params)).toEqual(['enero', 'febrero']);
    expect(live.loading()).toBeTrue();
    expect(live.value()).toBe('casos de enero');

    reads[1].answer('casos de febrero');
    await settle();
    expect(live.value()).toBe('casos de febrero');
  });

  it('cancels the read on its way when its params change, and never shows its answer', async () => {
    const live = create();
    params.set('febrero');
    TestBed.tick();
    expect(reads[0].abort.aborted).toBeTrue();
    expect(reads[1].abort.aborted).toBeFalse();

    reads[1].answer('casos de febrero');
    reads[0].answer('casos de enero');
    await settle();
    expect(live.value()).toBe('casos de febrero');
  });

  it('refresh() reads again with the same params, keeping what it had on screen meanwhile', async () => {
    const live = create();
    reads[0].answer('casos de enero');
    await settle();

    live.refresh();
    expect(live.loading()).toBeTrue();
    TestBed.tick();
    expect(reads.map((read) => read.params)).toEqual(['enero', 'enero']);
    expect(live.value()).toBe('casos de enero');

    reads[1].answer('casos de enero, otra vez');
    await settle();
    expect(live.loading()).toBeFalse();
    expect(live.value()).toBe('casos de enero, otra vez');
  });

  // The read on its way may have been taken before the change that asks for the new one.
  it('refresh() while a read is on its way cancels it and reads again', async () => {
    const live = create();
    live.refresh();
    TestBed.tick();
    expect(reads.length).toBe(2);
    expect(reads[0].abort.aborted).toBeTrue();

    reads[0].answer('antes del cambio');
    reads[1].answer('después del cambio');
    await settle();
    expect(live.value()).toBe('después del cambio');
  });

  /*
   * The list of cases does this with a page past its end: it goes to the last page there is.
   *
   * Changing the params also has Angular update the screen on its own, at the next frame or the
   * next task, whichever comes first, and that update starts the next read. A next read that
   * answered itself had answered before the spec looked in a run where the frame came first: it
   * is answered when the spec says, and the spec waits both ways.
   */
  for (const [order, wait] of [
    ['the next task', nextTask],
    ['a task after the next frame', afterNextFrame],
  ] as const) {
    it(`does not keep the answer of a load that asked for another read before giving it (waiting for ${order})`, async () => {
      const live = TestBed.runInInjectionContext(() =>
        liveResource({
          params,
          load: async (asked: string, abort: AbortSignal) => {
            if (asked !== 'enero') return new Promise<string>((resolve, reject) => reads.push({ params: asked, abort, answer: resolve, fail: reject }));
            await Promise.resolve();
            params.set('febrero');
            return 'casos de enero';
          },
          failed: (error) => failures.push(error),
        }),
      );
      TestBed.tick();
      await wait();
      TestBed.tick();
      expect(reads.map((read) => read.params)).toEqual(['febrero']);
      expect(live.value()).toBeUndefined();
      expect(live.loading()).toBeTrue();

      reads[0].answer('casos de febrero');
      await settle();
      expect(live.value()).toBe('casos de febrero');
      expect(live.loading()).toBeFalse();
      expect(failures).toEqual([]);
    });
  }

  // Its read is cancelled only at the next screen update: an answer can arrive before it.
  it('tells a load that its read is no longer the one asked for as soon as other params are', () => {
    const current: (() => boolean)[] = [];
    TestBed.runInInjectionContext(() =>
      liveResource({
        params,
        load: (_: string, __: AbortSignal, isCurrent: () => boolean) => {
          current.push(isCurrent);
          return new Promise<string>(() => undefined);
        },
        failed: (error) => failures.push(error),
      }),
    );
    TestBed.tick();
    expect(current.length).toBe(1);
    expect(current[0]()).toBeTrue();

    // Before the screen update that cancels its read, and would start the next one.
    params.set('febrero');
    expect(current[0]()).toBeFalse();

    TestBed.tick();
    expect(current.length).toBe(2);
    expect(current[0]()).toBeFalse();
    expect(current[1]()).toBeTrue();
  });

  // The same window, for a read that fails: the list of cases then leaves its page alone.
  it('tells a failure whether its read was still the one asked for', async () => {
    const told: boolean[] = [];
    TestBed.runInInjectionContext(() =>
      liveResource({
        params,
        load: (asked: string, abort: AbortSignal) =>
          new Promise<string>((resolve, reject) => reads.push({ params: asked, abort, answer: resolve, fail: reject })),
        failed: (_, current) => told.push(current()),
      }),
    );
    TestBed.tick();
    reads[0].fail(new Error('Error interno'));
    await settle();
    expect(told).toEqual([true]);

    params.set('febrero');
    TestBed.tick();
    // Answered before the screen update that would cancel it.
    params.set('marzo');
    reads[1].fail(new Error('Error interno'));
    await settle();
    expect(told).toEqual([true, false]);
  });

  it('passes a failure on, and keeps what it had on screen', async () => {
    const live = create();
    reads[0].answer('casos de enero');
    await settle();

    live.refresh();
    TestBed.tick();
    const refused = new Error('No hay conexión con el servidor');
    reads[1].fail(refused);
    await settle();
    expect(failures).toEqual([refused]);
    expect(live.loading()).toBeFalse();
    expect(live.value()).toBe('casos de enero');

    // And reads again after it.
    live.refresh();
    TestBed.tick();
    reads[2].answer('casos de enero, por fin');
    await settle();
    expect(live.value()).toBe('casos de enero, por fin');
  });

  it('says nothing of a read it cancelled', async () => {
    create();
    params.set('febrero');
    TestBed.tick();
    reads[0].fail(reads[0].abort.reason);
    reads[1].answer('casos de febrero');
    await settle();
    expect(failures).toEqual([]);
  });

  // A row replaced with the case as it was saved. Unlike resource's own value, the read on its way goes on.
  it('takes a change of its value made by the screen, until the next answer', async () => {
    const live = create();
    reads[0].answer('casos de enero');
    await settle();

    live.refresh();
    TestBed.tick();
    live.value.set('casos de enero, con uno guardado');
    expect(reads[1].abort.aborted).toBeFalse();
    expect(live.value()).toBe('casos de enero, con uno guardado');

    reads[1].answer('casos de enero, leídos otra vez');
    await settle();
    expect(live.value()).toBe('casos de enero, leídos otra vez');
  });

  it('cancels the read on its way when the screen goes away', () => {
    const screen = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(screen, () => liveResource({ load: unanswered, failed: () => undefined }));
    TestBed.tick();
    expect(reads.length).toBe(1);

    screen.destroy();
    expect(reads[0].abort.aborted).toBeTrue();
  });
});
