import { OpenTelemetryModule } from '@forepath/shared/backend/util-otel';
import { Module } from '@nestjs/common';

export const loadweaverOtelModule = OpenTelemetryModule.register({
  applicationId: 'loadweaver-control-plane',
});

@Module({
  imports: [loadweaverOtelModule],
  exports: [loadweaverOtelModule],
})
export class LoadweaverOtelModule {}
