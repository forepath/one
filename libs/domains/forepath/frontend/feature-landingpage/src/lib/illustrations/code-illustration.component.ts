import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';

interface CodeFile {
  id: 'php' | 'typescript' | 'java';
  name: string;
  logoUrl: string;
  keywords: readonly string[];
  source: string;
}

const ROTATION_INTERVAL_MS = 5000;

const FILES: readonly CodeFile[] = [
  {
    id: 'php',
    name: 'CancelOrder.php',
    logoUrl: 'assets/images/logos/php.svg',
    keywords: ['final', 'class', 'public', 'function', 'if', 'throw', 'new', 'return'],
    source: `final class CancelOrder
{
    public function __invoke(Order $order): Order
    {
        if ($order->isShipped()) {
            throw new OrderAlreadyShipped($order->id);
        }

        $order->cancel();
        event(new OrderCancelled($order));

        return $order->refresh();
    }
}`,
  },
  {
    id: 'typescript',
    name: 'cancel-order.service.ts',
    logoUrl: 'assets/images/logos/typescript.svg',
    keywords: [
      'export',
      'class',
      'constructor',
      'private',
      'readonly',
      'async',
      'const',
      'await',
      'if',
      'throw',
      'new',
      'return',
    ],
    source: `@Injectable()
export class CancelOrderService {
  constructor(private readonly orders: OrderRepository) {}

  async cancel(id: string): Promise<Order> {
    const order = await this.orders.findOrFail(id);

    if (order.isShipped()) {
      throw new OrderAlreadyShippedError(id);
    }

    return this.orders.save(order.cancel());
  }
}`,
  },
  {
    id: 'java',
    name: 'CancelOrderService.java',
    logoUrl: 'assets/images/logos/java.svg',
    keywords: ['public', 'class', 'private', 'final', 'if', 'throw', 'new', 'return'],
    source: `@Service
public class CancelOrderService {
    private final OrderRepository orders;

    public Order cancel(UUID id) {
        Order order = orders.findById(id).orElseThrow();

        if (order.isShipped()) {
            throw new OrderAlreadyShippedException(id);
        }

        return orders.save(order.cancel());
    }
}`,
  },
];

/** Minimal highlighter for the sample snippets: keywords, types (capitalised words) and strings. */
function highlight(source: string, keywords: readonly string[]): string[] {
  const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const keywordSet = new Set(keywords);

  return source.split('\n').map((line) =>
    line
      .split(/(\b[A-Za-z_]\w*\b|'[^']*')/)
      .map((part) => {
        if (/^'.*'$/.test(part)) return `<span class="sai-tok-str">${escape(part)}</span>`;
        if (keywordSet.has(part)) return `<span class="sai-tok-key">${part}</span>`;
        if (/^[A-Z]\w*$/.test(part)) return `<span class="sai-tok-fn">${part}</span>`;

        return escape(part);
      })
      .join(''),
  );
}

/** "What we build" scene: the same small service in PHP, TypeScript and Java, rotating tabs. */
@Component({
  selector: 'framework-forepath-code-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedAppIllustrationComponent],
  template: `
    <shared-app-illustration [label]="label()" windowTitle="Editor" [width]="760" [height]="520">
      <section class="sai-col sai-col--grow">
        <div class="code-illustration__tabs">
          @for (file of files; track file.id; let index = $index) {
            <span class="code-illustration__tab" [class.code-illustration__tab--active]="index === active()">
              <img [src]="file.logoUrl" alt="" />{{ file.name }}
            </span>
          }
        </div>
        <div class="sai-code sai-body py-3">
          @for (line of lines(); track $index) {
            <div class="sai-code__line">
              <span class="sai-code__no">{{ $index + 1 }}</span
              ><span [innerHTML]="line"></span>
            </div>
          }
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .code-illustration__tabs {
        display: flex;
        background-color: var(--bs-tertiary-bg);
        border-bottom: var(--bs-border-width) solid var(--bs-border-color);
      }

      .code-illustration__tab {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        font-size: 0.8125rem;
        color: var(--bs-secondary-color);
        border-right: var(--bs-border-width) solid var(--bs-border-color);
        transition:
          color 0.2s ease,
          background-color 0.2s ease;

        img {
          height: 0.875rem;
        }
      }

      .code-illustration__tab--active {
        color: var(--bs-body-color);
        background-color: var(--bs-body-bg);
        box-shadow: inset 0 2px 0 var(--bs-primary);
      }
    `,
  ],
})
export class CodeIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly files = FILES;
  protected readonly active = signal(0);
  protected readonly lines = computed(() => {
    const file = FILES[this.active()];

    return highlight(file.source, file.keywords);
  });

  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    effect((onCleanup) => {
      if (!isPlatformBrowser(this.platformId) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
      }

      const timer = setInterval(() => this.active.update((index) => (index + 1) % FILES.length), ROTATION_INTERVAL_MS);

      onCleanup(() => clearInterval(timer));
    });
  }
}
