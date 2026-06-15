import { Test, TestingModule } from '@nestjs/testing';

import { MonitoringModule } from './monitoring.module';

describe('MonitoringModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [MonitoringModule],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });
});
