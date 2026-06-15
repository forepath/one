import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import { META_PUBLIC } from 'nest-keycloak-connect';

import { HealthController, HealthResponseDto } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let controllerClass: typeof HealthController;
  let getHealthHandler: HealthController['getHealth'];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    controllerClass = HealthController;
    getHealthHandler = controllerClass.prototype.getHealth;
  });

  describe('getHealth', () => {
    it('should return health status with ok status', () => {
      const result = controller.getHealth();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('number');
    });

    it('should return current timestamp', () => {
      const before = Date.now();
      const result = controller.getHealth();
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('should return correct response structure', () => {
      const result: HealthResponseDto = controller.getHealth();

      expect(result).toEqual({
        status: 'ok',
        timestamp: expect.any(Number),
      });
    });

    it('should be public for both auth systems', () => {
      // "nest-keycloak-connect" uses metadata key "public"
      expect(Reflect.getMetadata(META_PUBLIC, controllerClass)).toBe(true);
      expect(Reflect.getMetadata(META_PUBLIC, getHealthHandler)).toBe(true);

      // Hybrid auth uses metadata key "isPublic"
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, controllerClass)).toBe(true);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, getHealthHandler)).toBe(true);
    });
  });
});
