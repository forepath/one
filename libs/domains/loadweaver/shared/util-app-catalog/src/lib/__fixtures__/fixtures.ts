/** Test fixtures: a small app package (no keys here; tests generate throwaway key pairs). */

export const DIGEST_A = `sha256:${'a'.repeat(64)}`;
export const DIGEST_B = `sha256:${'b'.repeat(64)}`;

export const MANIFEST_YAML = `apiVersion: apps.loadweaver.com/v1
name: wiki
version: 1.2.0
title: Wiki
description: A small wiki.
publisher: acme
license: AGPL-3.0-only
homepage: https://example.com/wiki
docs: https://example.com/wiki/docs
channels: [stable, beta]
parameters:
  type: object
  properties:
    hostname:
      type: string
      title: Hostname
      pattern: "^[a-z0-9.-]+$"
    port:
      type: integer
      default: 8080
      minimum: 1
      maximum: 65535
    debug:
      type: boolean
      default: false
    bundlePostgres:
      type: boolean
      default: true
    dbHost:
      type: string
      default: postgres
    plan:
      type: string
      enum: [small, large]
      default: small
  required: [hostname]
secrets:
  - name: db-password
    description: Database password
dependencies:
  - name: postgres
    bundled:
      parameter: bundlePostgres
      services: [postgres]
      volumes: [pgdata]
    provided:
      parameters: [dbHost]
healthChecks:
  - service: web
    type: http
    port: 8080
    path: /health
migrations:
  - version: 1.2.0
    steps:
      - name: migrate schema
        service: web
        command: [wiki, migrate]
`;

export const COMPOSE_YAML = `services:
  web:
    image: ghcr.io/acme/wiki:1.2.0@${DIGEST_A}
    environment:
      HOSTNAME: \${hostname}
      PORT: \${port}
      DEBUG: \${debug}
      DB_HOST: \${dbHost}
      DB_URL: "postgres://wiki@\${dbHost}:5432/wiki"
      DB_PASSWORD_FILE: /run/secrets/db-password
      PRICE: "$$5"
    secrets: [db-password]
    depends_on: [postgres]
  postgres:
    image: postgres:17@${DIGEST_B}
    volumes:
      - pgdata:/var/lib/postgresql/data
secrets:
  db-password:
    x-loadweaver-ref: \${secret:db-password}
volumes:
  pgdata: {}
`;

export const README = '# Wiki\n\nA small wiki.\n';
