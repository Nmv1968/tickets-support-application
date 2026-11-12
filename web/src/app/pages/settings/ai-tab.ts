import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { AiModel, AiProviderConfig } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { Toast } from '../../core/toast';
import { errorMessage } from '../../core/ui';

/**
 * AI provider setup: pick a provider, enter its API key, load the models that
 * key gives access to, choose one and test it. The key is stored encrypted on
 * the server and never comes back to the browser.
 */
@Component({
  selector: 'app-ai-tab',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card max-w-2xl space-y-4 p-4">
      <div>
        <h2 class="font-semibold">Proveedor de IA</h2>
        <p class="text-xs text-muted">Se usa para crear casos desde una foto, una captura o un texto. Solo un proveedor está activo a la vez.</p>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        @for (provider of providers(); track provider.id) {
          <button
            type="button"
            class="rounded-control border px-3 py-2 text-left"
            [class]="selectedId() === provider.id ? 'border-primary bg-primary/5' : 'border-line hover:bg-elevated'"
            (click)="select(provider.id)"
          >
            <div class="flex items-center gap-2">
              <span class="flex-1 font-medium">{{ provider.label }}</span>
              @if (provider.active) {
                <span class="badge st-RESOLVED">Activo</span>
              }
            </div>
            <div class="text-xs text-muted">
              {{ provider.hasKey ? 'API key guardada ' + provider.keyHint : 'Sin API key' }}{{ provider.model ? ' · ' + provider.model : '' }}
            </div>
          </button>
        }
      </div>

      @if (selected(); as p) {
        <div class="space-y-3 border-t border-line pt-4">
          @if (p.needsBaseUrl) {
            <div>
              <label class="label" for="ai-url">URL del servidor</label>
              <input id="ai-url" class="input" placeholder="https://openrouter.ai/api/v1" autocomplete="off" [(ngModel)]="baseUrl" />
              <p class="mt-1 text-2xs text-muted">
                Ejemplos: OpenRouter https://openrouter.ai/api/v1 · Groq https://api.groq.com/openai/v1 · Ollama local http://localhost:11434/v1
                (con Docker usa http://host.docker.internal:11434/v1).
              </p>
            </div>
          }

          <div>
            <label class="label" for="ai-key">API key{{ p.keyOptional ? ' (opcional en servidores locales)' : '' }}</label>
            <input
              id="ai-key"
              class="input"
              type="password"
              autocomplete="off"
              [placeholder]="p.hasKey && !urlChanged() ? 'Guardada ' + p.keyHint + ' — escribe otra para reemplazarla' : 'Pega aquí la API key'"
              [(ngModel)]="apiKey"
            />
            @if (urlChanged() && !apiKey().trim()) {
              <p class="mt-1 rounded-control bg-warning/10 px-3 py-2 text-xs" role="status">
                <i class="mdi mdi-alert-outline text-warning" aria-hidden="true"></i>
                Cambiaste la URL del servidor. La API key guardada es de la URL anterior y no se envía a otra: escríbela de nuevo. Si guardas sin
                escribirla, la guardada se borra.
              </p>
            }
          </div>

          <div>
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <label class="label" for="ai-model">Modelo</label>
                @if (models().length) {
                  <select id="ai-model" class="input" [(ngModel)]="model">
                    <option value="">Elige un modelo</option>
                    @for (item of models(); track item.id) {
                      <option [value]="item.id">{{ item.name }}{{ item.vision === true ? ' · lee imágenes' : item.vision === false ? ' · solo texto' : '' }}</option>
                    }
                  </select>
                } @else {
                  <input id="ai-model" class="input" placeholder="Carga los modelos o escribe el identificador" autocomplete="off" [(ngModel)]="model" />
                }
              </div>
              <button type="button" class="btn btn-soft" [disabled]="busy() !== ''" (click)="loadModels()">
                <i class="mdi" [class]="busy() === 'models' ? 'mdi-loading mdi-spin' : 'mdi-refresh'" aria-hidden="true"></i>
                Cargar modelos
              </button>
            </div>
            <p class="mt-1 text-2xs text-muted">La lista sale del proveedor con tu API key. Para crear casos desde fotos el modelo debe leer imágenes; "Probar" lo verifica.</p>
          </div>

          @if (result(); as r) {
            <p class="rounded-control px-3 py-2" [class]="r.ok ? 'st-RESOLVED' : 'st-UNRESOLVED'" role="status">{{ r.message }}</p>
          }

          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary" [disabled]="busy() !== '' || !model().trim()" (click)="save(true)">
              {{ busy() === 'save' ? 'Guardando…' : 'Guardar y activar' }}
            </button>
            <button type="button" class="btn btn-soft" [disabled]="busy() !== '' || !model().trim()" (click)="test()">
              <i class="mdi" [class]="busy() === 'test' ? 'mdi-loading mdi-spin' : 'mdi-connection'" aria-hidden="true"></i>
              {{ busy() === 'test' ? 'Probando…' : 'Guardar y probar' }}
            </button>
            @if (p.hasKey) {
              <button type="button" class="btn btn-ghost ml-auto" [disabled]="busy() !== ''" (click)="removeKey()">Quitar API key</button>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class AiTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly catalogs = inject(Catalogs);

  protected readonly providers = signal<AiProviderConfig[]>([]);
  protected readonly selectedId = signal('');
  protected readonly selected = computed(() => this.providers().find((p) => p.id === this.selectedId()) ?? null);

  protected readonly apiKey = signal('');
  protected readonly baseUrl = signal('');
  protected readonly model = signal('');
  protected readonly models = signal<AiModel[]>([]);
  /**
   * The form's server URL is not the one the stored key was saved with. The server sends a stored
   * key only to its own URL, so the key has to be typed again. Compared as the server compares:
   * trimmed and without trailing slashes.
   */
  protected readonly urlChanged = computed(() => {
    const provider = this.selected();
    if (!provider?.needsBaseUrl || !provider.hasKey) return false;
    return this.baseUrl().trim().replace(/\/+$/, '') !== (provider.baseUrl ?? '');
  });
  protected readonly busy = signal<'' | 'models' | 'save' | 'test'>('');
  protected readonly result = signal<{ ok: boolean; message: string } | null>(null);

  constructor() {
    void this.reload().then(() => {
      const providers = this.providers();
      this.select((providers.find((p) => p.active) ?? providers[0])?.id ?? '');
    });
  }

  private async reload(): Promise<void> {
    try {
      this.providers.set(await this.api.aiConfig());
      // Other screens offer AI actions only when a provider is active.
      this.catalogs.aiReady.set(this.providers().some((provider) => provider.active && !!provider.model));
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    const provider = this.selected();
    this.apiKey.set('');
    this.baseUrl.set(provider?.baseUrl ?? '');
    this.model.set(provider?.model ?? '');
    this.models.set([]);
    this.result.set(null);
  }

  protected async loadModels(): Promise<void> {
    this.busy.set('models');
    this.result.set(null);
    try {
      const models = await this.api.aiModels(this.selectedId(), this.apiKey().trim(), this.selected()?.needsBaseUrl ? this.baseUrl().trim() : undefined);
      this.models.set(models);
      if (!models.some((m) => m.id === this.model())) this.model.set('');
      this.result.set({ ok: true, message: `La API key es válida. ${models.length} modelos disponibles.` });
    } catch (error) {
      this.result.set({ ok: false, message: errorMessage(error) });
    } finally {
      this.busy.set('');
    }
  }

  /** Stores the form. Returns false when saving failed. */
  protected async save(activate: boolean): Promise<boolean> {
    this.busy.set('save');
    try {
      const provider = this.selected();
      await this.api.saveAiConfig(this.selectedId(), {
        apiKey: this.apiKey().trim() || undefined,
        baseUrl: provider?.needsBaseUrl ? this.baseUrl().trim() : undefined,
        model: this.model().trim(),
        active: activate ? true : undefined,
      });
      this.apiKey.set('');
      await this.reload();
      if (activate) this.toast.ok(`${provider?.label ?? 'Proveedor'} activo`);
      return true;
    } catch (error) {
      this.result.set({ ok: false, message: errorMessage(error) });
      return false;
    } finally {
      this.busy.set('');
    }
  }

  protected async test(): Promise<void> {
    this.result.set(null);
    if (!(await this.save(false))) return;
    this.busy.set('test');
    try {
      const outcome = await this.api.aiTest(this.selectedId());
      this.result.set({ ok: outcome.ok, message: `${outcome.message} (${(outcome.ms / 1000).toFixed(1)} s)` });
    } catch (error) {
      this.result.set({ ok: false, message: errorMessage(error) });
    } finally {
      this.busy.set('');
    }
  }

  protected async removeKey(): Promise<void> {
    if (!confirm('¿Quitar la API key guardada de este proveedor?')) return;
    try {
      await this.api.saveAiConfig(this.selectedId(), { apiKey: '', active: false });
      await this.reload();
      this.toast.ok('API key eliminada');
    } catch (error) {
      this.toast.error(error);
    }
  }
}
