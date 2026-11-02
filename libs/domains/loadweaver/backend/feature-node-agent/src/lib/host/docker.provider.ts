import Docker from 'dockerode';

export const DOCKER = Symbol('LOADWEAVER_DOCKER');

/** Local Docker Engine (P1); the socket path can be overridden for tests. */
export const dockerProvider = {
  provide: DOCKER,
  useFactory: (): Docker =>
    new Docker({ socketPath: process.env['LOADWEAVER_DOCKER_SOCKET'] || '/var/run/docker.sock' }),
};
