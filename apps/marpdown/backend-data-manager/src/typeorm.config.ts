import { PresentationAssetEntity, PresentationEntity } from '@forepath/marpdown/backend/feature-data-manager';
import { CorrelationAwareTypeOrmLogger } from '@forepath/shared/backend/util-http-context';
import { UserEntity } from '@forepath/identity/backend';
import { DataSource, DataSourceOptions } from 'typeorm';

export const typeormConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'marpdown',
  entities: [UserEntity, PresentationEntity, PresentationAssetEntity],
  migrations: [
    'src/migrations/*.js',
    'apps/marpdown/backend-data-manager/src/migrations/*.ts',
    'libs/domains/identity/backend/util-auth/src/lib/migrations/*.ts',
  ],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : false,
  logger: new CorrelationAwareTypeOrmLogger(),
};

export default new DataSource(typeormConfig);
