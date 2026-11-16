import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { Icon } from './icon';
import { errorMessage } from './ui';

interface ToastItem {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class Toast {
  readonly items = signal<ToastItem[]>([]);
  private nextId = 1;

  ok(text: string): void {
    this.push('ok', text, 3000);
  }

  /** Accepts a message or any thrown value (HTTP errors show the server's message). */
  error(error: unknown): void {
    this.push('error', typeof error === 'string' ? error : errorMessage(error), 6000);
  }

  dismiss(id: number): void {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }

  private push(kind: ToastItem['kind'], text: string, ms: number): void {
    const id = this.nextId++;
    this.items.update((items) => [...items, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}

@Component({
  selector: 'app-toasts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pointer-events-none fixed right-4 bottom-4 z-100 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" [attr.aria-live]="live()">
      @for (item of toast.items(); track item.id) {
        <button
          type="button"
          class="card pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-left"
          [class.border-danger]="item.kind === 'error'"
          (click)="toast.dismiss(item.id)"
        >
          <app-icon
            [name]="item.kind === 'ok' ? 'check-circle' : 'alert-circle'"
            class="text-lg leading-5"
            [class.text-success]="item.kind === 'ok'"
            [class.text-danger]="item.kind === 'error'"
          />
          <span class="flex-1">{{ item.text }}</span>
        </button>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toast = inject(Toast);
  /**
   * An error is read out at once, interrupting the screen reader; any other toast waits for it to
   * finish. The region takes the politeness of the toast that came last: the one it is about to read.
   */
  protected readonly live = computed(() => (this.toast.items().at(-1)?.kind === 'error' ? 'assertive' : 'polite'));
}
