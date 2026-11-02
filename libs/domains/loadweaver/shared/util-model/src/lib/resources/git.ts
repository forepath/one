import { z } from 'zod';

import { secretRefSchema } from './edge';

const httpsUrlSchema = z.url({ protocol: /^https$/ }).max(512);

/** PEM CA certificate(s) for a provider behind a private CA (GitHub Enterprise Server, self-managed GitLab). */
const caCertificateSchema = z
  .string()
  .max(65_536)
  .refine((v) => /-----BEGIN CERTIFICATE-----/.test(v) && !/PRIVATE KEY/.test(v), 'expected PEM certificates');

/**
 * The Loadweaver GitHub App (3.30): the plan bot authenticates as an installation (RS256 app JWT → installation
 * token); OAuth client id / secret link GitHub accounts to Loadweaver users. Secrets are references only.
 */
export const clusterGitHubSchema = z
  .object({
    /** The GitHub App's id; with `privateKey`, connections without own credentials use installation tokens. */
    appId: z.number().int().positive().optional(),
    /** `secret://…` holding the app's PEM private key. */
    privateKey: secretRefSchema.optional(),
    /** OAuth client id of the app (account linking). */
    clientId: z.string().min(1).max(100).optional(),
    /** `secret://…` holding the OAuth client secret. */
    clientSecret: secretRefSchema.optional(),
    /** Web base for the OAuth pages (GitHub Enterprise Server: `https://ghe.example.com`). */
    webUrl: httpsUrlSchema.default('https://github.com'),
    /** REST API base for account linking (GitHub Enterprise Server: `https://ghe.example.com/api/v3`). */
    apiUrl: httpsUrlSchema.default('https://api.github.com'),
    caCertificate: caCertificateSchema.optional(),
  })
  .strict()
  .superRefine((gh, ctx) => {
    if (!!gh.appId !== !!gh.privateKey)
      ctx.addIssue({ code: 'custom', message: 'appId and privateKey go together', path: ['privateKey'] });

    if (!!gh.clientId !== !!gh.clientSecret)
      ctx.addIssue({ code: 'custom', message: 'clientId and clientSecret go together', path: ['clientSecret'] });
  });
export type ClusterGitHub = z.infer<typeof clusterGitHubSchema>;

/**
 * GitLab (3.30): the bot uses each connection's project / group access token; an OAuth application links GitLab
 * accounts to Loadweaver users. One instance per cluster (gitlab.com or self-managed).
 */
export const clusterGitLabSchema = z
  .object({
    /** Instance URL (`https://gitlab.example.com`); OAuth and the user API live below it. */
    url: httpsUrlSchema.default('https://gitlab.com'),
    /** OAuth application id (account linking). */
    applicationId: z.string().min(1).max(200).optional(),
    /** `secret://…` holding the OAuth application secret. */
    applicationSecret: secretRefSchema.optional(),
    caCertificate: caCertificateSchema.optional(),
  })
  .strict()
  .superRefine((gl, ctx) => {
    if (!!gl.applicationId !== !!gl.applicationSecret)
      ctx.addIssue({
        code: 'custom',
        message: 'applicationId and applicationSecret go together',
        path: ['applicationSecret'],
      });
  });
export type ClusterGitLab = z.infer<typeof clusterGitLabSchema>;

/** Plan bot and account linking settings (3.29 / 3.30); connections themselves are direct API. */
export const clusterGitSchema = z
  .object({
    github: clusterGitHubSchema.optional(),
    gitlab: clusterGitLabSchema.optional(),
  })
  .strict();
export type ClusterGit = z.infer<typeof clusterGitSchema>;
