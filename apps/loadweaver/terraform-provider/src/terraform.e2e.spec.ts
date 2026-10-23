/**
 * Gate spec (P gate; needs network on the first run and the provider bundle): runs the real Terraform CLI against
 * the built provider and a fake control plane over HTTP.
 *
 *   nx run loadweaver-terraform-provider:test-e2e
 *
 * Terraform is downloaded from releases.hashicorp.com into the temp directory and checked against the SHA-256
 * pinned below before it runs. The provider is the single executable (`nx run loadweaver-terraform-provider:sea`)
 * if it was built, else the webpack bundle run by the current Node. No Docker.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { FakeControlPlane } from '@forepath/loadweaver/backend/feature-terraform-provider';

const TERRAFORM_VERSION = '1.16.4';
/** From https://releases.hashicorp.com/terraform/1.16.4/terraform_1.16.4_SHA256SUMS */
const TERRAFORM_SHA256: Record<string, string> = {
  linux_amd64: 'dc94af0eef1147718ad7c8daea792ed199e3e0492eec180d0adafa2a65a879df',
  linux_arm64: '8263f301cb1a24489a4adeed147bf28504053f77237b3ea97a0ef2972659de30',
  darwin_amd64: '2ee4b62064086e4b24b0d6cf2e61718fbaf0556feba990f708a5e32557554b3b',
  darwin_arm64: '42cfdf97ad722f79085fe2279b06d4b8680172de3534b22eeddd9a0fbbe7b8f1',
};
const ROOT = resolve(__dirname, '../../../..');
const BUNDLE = join(ROOT, 'dist/apps/loadweaver/terraform-provider/main.js');
const SEA = join(ROOT, 'dist/apps/loadweaver/terraform-provider/sea/terraform-provider-loadweaver');

jest.setTimeout(10 * 60_000);

/** The one member of a zip archive (stored or deflated), enough for the Terraform release zip. */
function unzipMember(zip: Buffer, name: string): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const entry = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (entry === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);

      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`${name} not in archive`);
}

async function terraformBinary(dir: string): Promise<string> {
  const platform = `${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
  const expected = TERRAFORM_SHA256[platform];

  if (!expected) throw new Error(`no pinned Terraform build for ${platform}`);

  const cache = join(tmpdir(), 'lw-terraform-e2e');
  const zipPath = join(cache, `terraform_${TERRAFORM_VERSION}_${platform}.zip`);

  mkdirSync(cache, { recursive: true });

  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  if (!existsSync(zipPath) || sha(readFileSync(zipPath)) !== expected) {
    const response = await fetch(
      `https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_${platform}.zip`,
    );

    if (!response.ok) throw new Error(`Terraform download: HTTP ${response.status}`);

    writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  }

  const zip = readFileSync(zipPath);

  if (sha(zip) !== expected) throw new Error('Terraform download does not match the pinned SHA-256');

  const binary = join(dir, 'terraform');

  writeFileSync(binary, unzipMember(zip, 'terraform'));
  chmodSync(binary, 0o755);

  return binary;
}

function providerDir(dir: string): string {
  const bin = join(dir, 'providers');

  mkdirSync(bin, { recursive: true });

  if (existsSync(SEA)) {
    copyFileSync(SEA, join(bin, 'terraform-provider-loadweaver'));
    chmodSync(join(bin, 'terraform-provider-loadweaver'), 0o755);

    return bin;
  }

  if (!existsSync(BUNDLE)) throw new Error('build the provider first: nx run loadweaver-terraform-provider:build:sea');

  // The repository's package.json is `type: module`; the CommonJS bundle runs as .cjs.
  copyFileSync(BUNDLE, join(dir, 'provider.cjs'));
  writeFileSync(
    join(bin, 'terraform-provider-loadweaver'),
    `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'provider.cjs')}" "$@"\n`,
  );
  chmodSync(join(bin, 'terraform-provider-loadweaver'), 0o755);

  return bin;
}

const COMPOSE = `services:
  web:
    image: nginx:\${TAG}
    labels:
      app: web
`;

function config(endpoint: string, extra = ''): string {
  return `
terraform {
  required_providers {
    loadweaver = { source = "forepath/loadweaver" }
  }
}

variable "tag" {
  type    = string
  default = "1.27"
}

provider "loadweaver" {
  endpoint         = "${endpoint}"
  project          = "shop"
  poll_interval    = "100ms"
  approval_timeout = "2m"
  # The fake control plane listens on plain HTTP (loopback).
  insecure_http    = true
}

resource "loadweaver_project" "shop" {
  name        = "shop"
  description = "The shop"
  quota_cpu   = "8"
}

resource "loadweaver_deployment" "site" {
  name      = "site"
  project   = loadweaver_project.shop.name
  compose   = ${JSON.stringify(COMPOSE).replace(/\$\{/g, () => '$${')}
  variables = { TAG = var.tag }
}

resource "loadweaver_workload_group" "web" {
  name    = "web"
  project = loadweaver_project.shop.name
  spec    = jsonencode({ selector = { matchLabels = { app = "web" } } })
}

resource "loadweaver_policy" "web_in" {
  name    = "web-in"
  project = loadweaver_project.shop.name
  spec = jsonencode({
    from  = [{ builtin = "internet" }]
    to    = [{ group = loadweaver_workload_group.web.name }]
    rules = [{ protocol = "tcp", ports = [80] }]
  })
}

data "loadweaver_deployment_status" "site" {
  name    = loadweaver_deployment.site.name
  project = loadweaver_project.shop.name
}

output "replicas" {
  value = length(data.loadweaver_deployment_status.site.replicas)
}
${extra}`;
}

describe('terraform CLI against the provider (gate)', () => {
  const fake = new FakeControlPlane('e2e-token');
  let dir: string;
  let terraform: string;
  let api: { url: string; close: () => Promise<void> };
  let env: NodeJS.ProcessEnv;

  const run = (args: string[]) =>
    new Promise<{ code: number; out: string }>((done) => {
      execFile(terraform, [...args, '-no-color'], { cwd: join(dir, 'work'), env }, (error, stdout, stderr) =>
        done({ code: error ? Number(error.code ?? 1) : 0, out: `${stdout}\n${stderr}` }),
      );
    });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lw-tf-e2e-'));
    terraform = await terraformBinary(dir);
    api = await fake.listen();
    mkdirSync(join(dir, 'work'));
    writeFileSync(
      join(dir, 'tfrc'),
      `provider_installation {\n  dev_overrides {\n    "forepath/loadweaver" = "${providerDir(dir)}"\n  }\n  direct {}\n}\n`,
    );
    writeFileSync(join(dir, 'work', 'main.tf'), config(api.url));
    env = {
      PATH: process.env['PATH'],
      HOME: dir,
      TF_CLI_CONFIG_FILE: join(dir, 'tfrc'),
      TF_IN_AUTOMATION: '1',
      CHECKPOINT_DISABLE: '1',
      LOADWEAVER_TOKEN: 'e2e-token',
    };
  });

  afterAll(async () => {
    await api?.close();

    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('plans with a Loadweaver dry-run plan and creates nothing', async () => {
    const { code, out } = await run(['plan', '-input=false']);

    expect(out).toContain('Plan: 4 to add, 0 to change, 0 to destroy.');
    expect(code).toBe(0);
    // Effects of the dry-run plans beyond the resource diff: network changes of the policy, the new replica.
    expect(out).toContain('Loadweaver dry-run plan: create Policy shop/web-in');
    expect(out).toContain('filtering create on node-1: policy web-in');
    expect(out).toContain('start shop/site/web/0 to node-1');
    expect(fake.resources.size).toBe(0);
    // Every dry-run plan was discarded again.
    expect([...fake.plans.values()].every((p) => p.status === 'discarded')).toBe(true);
  });

  it('applies through Loadweaver plans', async () => {
    const { code, out } = await run(['apply', '-input=false', '-auto-approve']);

    expect(out).toContain('Apply complete! Resources: 4 added, 0 changed, 0 destroyed.');
    expect(code).toBe(0);
    expect(out).toContain('replicas = 1');
    expect([...fake.resources.keys()].sort()).toEqual([
      'Deployment/shop/site',
      'Policy/shop/web-in',
      'Project/shop',
      'WorkloadGroup/shop/web',
    ]);
    expect(fake.resources.get('Project/shop')?.spec).toMatchObject({ description: 'The shop', quota: { cpu: '8' } });
  });

  it('shows no changes when the cluster matches (defaults filled in by the control plane)', async () => {
    const { code, out } = await run(['plan', '-input=false', '-detailed-exitcode']);

    expect(out).toContain('No changes.');
    expect(code).toBe(0);
  });

  it('detects drift and puts the configuration back', async () => {
    const policy = fake.resources.get('Policy/shop/web-in');

    fake.seed({
      ...policy!,
      spec: { ...(policy!.spec as object), rules: [{ protocol: 'tcp', ports: [8080] }] } as never,
    });

    const plan = await run(['plan', '-input=false', '-detailed-exitcode']);

    expect(plan.out).toContain('loadweaver_policy.web_in will be updated in-place');
    expect(plan.code).toBe(2);

    const apply = await run(['apply', '-input=false', '-auto-approve']);

    expect(apply.code).toBe(0);
    expect((fake.resources.get('Policy/shop/web-in')?.spec as { rules: unknown[] }).rules).toEqual([
      { protocol: 'tcp', ports: [80] },
    ]);
  });

  it('waits for a required approval during apply', async () => {
    fake.approvalRequired.add('shop');

    const child = spawn(terraform, ['apply', '-input=false', '-auto-approve', '-no-color', '-var', 'tag=1.28'], {
      cwd: join(dir, 'work'),
      env,
    });
    let out = '';

    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));

    const exited = new Promise<number>((done) => child.on('close', (code) => done(code ?? 1)));
    // An approver approves once the provider is waiting (its apply was refused with blockers).
    const deadline = Date.now() + 60_000;

    for (;;) {
      const waiting = fake.pendingPlans().find((p) => fake.requests.some((r) => r.path === `/plans/${p.id}/apply`));

      if (waiting) {
        fake.approve(waiting.id);
        break;
      }

      if (Date.now() > deadline) throw new Error(`provider never waited for approval:\n${out}`);

      await new Promise((r) => setTimeout(r, 200));
    }

    expect(await exited).toBe(0);
    expect(out).toContain('was approved');
    expect((fake.resources.get('Deployment/shop/site')?.spec as { variables: unknown }).variables).toEqual({
      TAG: '1.28',
    });
    fake.approvalRequired.clear();
  });

  it('imports an existing resource', async () => {
    fake.seed({
      apiVersion: 'loadweaver.com/v1',
      kind: 'WorkloadGroup',
      metadata: { name: 'api', project: 'shop' },
      spec: { selector: { matchLabels: { app: 'api' } }, intraGroup: 'allow', exposed: false },
    } as never);
    writeFileSync(
      join(dir, 'work', 'main.tf'),
      config(
        api.url,
        `
resource "loadweaver_workload_group" "api" {
  name = "api"
  spec = jsonencode({ selector = { matchLabels = { app = "api" } } })
}
`,
      ),
    );

    const imported = await run([
      'import',
      '-input=false',
      '-var',
      'tag=1.28',
      'loadweaver_workload_group.api',
      'shop/api',
    ]);

    expect(imported.out).toContain('Import successful!');
    expect(imported.code).toBe(0);

    const show = await run(['state', 'show', 'loadweaver_workload_group.api']);

    expect(show.out).toContain('"WorkloadGroup/shop/api"');
  });

  it('destroys through Loadweaver plans', async () => {
    const { code, out } = await run(['destroy', '-input=false', '-auto-approve', '-var', 'tag=1.28']);

    expect(out).toContain('Destroy complete! Resources: 5 destroyed.');
    expect(code).toBe(0);
    expect(fake.resources.size).toBe(0);
  });
});
