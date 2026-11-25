import type { SpoolJobEntity } from '../entities/spool-job.entity';
import { SpoolPermanentError } from '../spool-kind-handler.interface';

import {
  InventoryLabelsSpoolHandler,
  InventoryMovementSpoolHandler,
  ProjectTimeReportSpoolHandler,
} from './printout.spool-handlers';

const UUID = '3f6c2a1e-4b7d-4c9a-8e2f-1a2b3c4d5e6f';
const job = (payload: Record<string, unknown>) => ({ id: 'job-1', payload }) as unknown as SpoolJobEntity;

describe('printout spool handlers', () => {
  it('renders labels from the re-validated request', async () => {
    const labels = {
      render: jest.fn(async () => ({ buffer: Buffer.from('%PDF'), fileName: 'labels 1.pdf', count: 2 })),
    };
    const handler = new InventoryLabelsSpoolHandler(labels as never);

    await expect(handler.run(job({ labels: { kinds: ['property'], articleIds: [UUID] } }))).resolves.toEqual({
      output: { content: Buffer.from('%PDF'), fileName: 'labels_1.pdf', contentType: 'application/pdf' },
      payload: { count: 2 },
    });
    await expect(handler.run(job({ labels: { kinds: ['property'], extra: 'x' } }))).rejects.toBeInstanceOf(
      SpoolPermanentError,
    );
    await expect(handler.run(job({ labels: { kinds: ['nope'] } }))).rejects.toBeInstanceOf(SpoolPermanentError);
  });

  it('renders the movement document of a valid movement id only', async () => {
    const movements = {
      getPdf: jest.fn(async () => ({ buffer: Buffer.from('%PDF'), fileName: 'PUT-2026-00001.pdf' })),
    };
    const handler = new InventoryMovementSpoolHandler(movements as never);

    await expect(handler.run(job({ movementId: UUID }))).resolves.toEqual({
      output: { content: Buffer.from('%PDF'), fileName: 'PUT-2026-00001.pdf', contentType: 'application/pdf' },
    });
    await expect(handler.run(job({ movementId: '../x' }))).rejects.toBeInstanceOf(SpoolPermanentError);
  });

  it('renders the time report for the period', async () => {
    const projects = { generateTimeReport: jest.fn(async () => Buffer.from('%PDF')) };
    const handler = new ProjectTimeReportSpoolHandler(projects as never);

    await handler.run(job({ projectId: UUID, request: { from: '2026-11-01', to: '2026-11-30', unbilledOnly: true } }));

    expect(projects.generateTimeReport).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ from: '2026-11-01', to: '2026-11-30', unbilledOnly: true }),
    );
    await expect(handler.run(job({ projectId: UUID, request: { from: 'yesterday' } }))).rejects.toBeInstanceOf(
      SpoolPermanentError,
    );
  });
});
