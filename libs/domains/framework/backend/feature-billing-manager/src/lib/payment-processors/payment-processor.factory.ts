import { Injectable, Logger } from '@nestjs/common';

import { PaymentProcessor } from './payment-processor.interface';

@Injectable()
export class PaymentProcessorFactory {
  private readonly logger = new Logger(PaymentProcessorFactory.name);
  private readonly processors = new Map<string, PaymentProcessor>();

  registerProcessor(processor: PaymentProcessor): void {
    const type = processor.getType();

    if (this.processors.has(type)) {
      this.logger.warn(`Payment processor '${type}' is already registered. Overwriting.`);
    }

    this.processors.set(type, processor);
    this.logger.log(`Registered payment processor: ${type}`);
  }

  getProcessor(type: string): PaymentProcessor {
    const processor = this.processors.get(type);

    if (!processor) {
      const available = Array.from(this.processors.keys()).join(', ');

      throw new Error(`Payment processor '${type}' not found. Available: ${available || 'none'}`);
    }

    return processor;
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.processors.keys());
  }
}
