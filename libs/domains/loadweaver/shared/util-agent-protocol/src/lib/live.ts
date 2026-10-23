import { z } from 'zod';

/**
 * Live sessions over the node stream (3.19): terminals, file operations and debug tunnels, each on its own envelope
 * `channel`. The control plane checks access first; the node only does what a message asks for, within its own
 * workloads, volumes and (if enabled) host.
 */

/** `project/deployment/service/index` (a replica's placement id). */
export const replicaIdSchema = z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,4}$/);
/** `project/deployment/volume`. */
export const volumeIdSchema = z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/);

const base64Chunk = (maxBytes: number) =>
  z
    .string()
    .max(Math.ceil(maxBytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/);

/** Terminal and file data travel in chunks of at most 256 KiB (well below the envelope limit). */
export const LIVE_CHUNK_BYTES = 256 * 1024;

export const execTargetSchema = z.union([
  z.object({ kind: z.literal('replica'), replica: replicaIdSchema }).strict(),
  /** Root shell on the node: disabled unless the cluster enables it (3.19). */
  z.object({ kind: z.literal('node') }).strict(),
]);
export type ExecTarget = z.infer<typeof execTargetSchema>;

export const execOpenSchema = z
  .object({
    target: execTargetSchema,
    /** Shell to start; default: the first of bash / sh that exists. */
    command: z.array(z.string().max(256)).min(1).max(16).optional(),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
    /**
     * Machine exec (feature `exec-stdio`): `false` runs the command without a TTY, stdout and stderr apart and
     * binary-safe, stdin closable (`execInput.eof`); replicas only. Absent: a terminal.
     */
    tty: z.boolean().optional(),
    /** User to run as (`name`, `uid` or `uid:gid`), machine exec only. */
    user: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,32}(:[A-Za-z0-9_.-]{1,32})?$/)
      .optional(),
    workingDir: z
      .string()
      .max(4096)
      .regex(/^\/[^\0]*$/)
      .optional(),
    /** `NAME=value` entries added to the process environment. */
    env: z
      .array(
        z
          .string()
          .max(32768)
          .regex(/^[A-Za-z_][A-Za-z0-9_.-]*=[^\0]*$/),
      )
      .max(256)
      .optional(),
  })
  .strict();
export type ExecOpen = z.infer<typeof execOpenSchema>;

/**
 * A VM console (3.35, feature `vm-consoles`): `serial` (TTY, resize ignored) or `vnc` (raw RFB on stdio, no TTY),
 * attached inside the replica's launcher. Data then uses `execInput` / `execOutput` / `execResize` / `execClose` /
 * `execExit` on the same channel, as terminals do.
 */
export const consoleOpenSchema = z
  .object({
    target: z.object({ kind: z.literal('replica'), replica: replicaIdSchema }).strict(),
    kind: z.enum(['serial', 'vnc']),
    cols: z.number().int().min(1).max(1000).optional(),
    rows: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type ConsoleOpen = z.infer<typeof consoleOpenSchema>;

export const execInputSchema = z
  .object({
    data: base64Chunk(LIVE_CHUNK_BYTES),
    /** Closes the process's stdin after `data` (machine exec, feature `exec-stdio`). */
    eof: z.literal(true).optional(),
  })
  .strict();
export const execResizeSchema = z
  .object({ cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) })
  .strict();
export const execCloseSchema = z.object({}).strict();
export const execOutputSchema = z
  .object({
    data: base64Chunk(LIVE_CHUNK_BYTES),
    /** Machine exec: output of stderr (absent: stdout, or the terminal). */
    stream: z.literal('stderr').optional(),
  })
  .strict();
export const execExitSchema = z
  .object({ code: z.number().int().nullable(), error: z.string().max(1024).optional() })
  .strict();

export const fileTargetSchema = z.union([
  z.object({ kind: z.literal('replica'), replica: replicaIdSchema }).strict(),
  /** A volume, on the node holding its primary replica. */
  z.object({ kind: z.literal('volume'), volume: volumeIdSchema }).strict(),
]);
export type FileTarget = z.infer<typeof fileTargetSchema>;

const filePath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\/[^\0]*$/, 'absolute path without NUL');

/** One file operation; answered by a `fileResponse` with the same correlation id. */
export const fileRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('list'), target: fileTargetSchema, path: filePath }).strict(),
  z.object({ op: z.literal('stat'), target: fileTargetSchema, path: filePath }).strict(),
  z
    .object({
      op: z.literal('read'),
      target: fileTargetSchema,
      path: filePath,
      offset: z.number().int().min(0),
      length: z.number().int().min(1).max(LIVE_CHUNK_BYTES),
    })
    .strict(),
  z
    .object({
      op: z.literal('write'),
      target: fileTargetSchema,
      path: filePath,
      offset: z.number().int().min(0),
      data: base64Chunk(LIVE_CHUNK_BYTES),
      /** First chunk: truncate (create or replace); later chunks append at `offset`. */
      truncate: z.boolean(),
    })
    .strict(),
  z.object({ op: z.literal('mkdir'), target: fileTargetSchema, path: filePath }).strict(),
  z.object({ op: z.literal('delete'), target: fileTargetSchema, path: filePath }).strict(),
  z
    .object({
      op: z.enum(['move', 'copy']),
      target: fileTargetSchema,
      path: filePath,
      to: filePath,
      overwrite: z.boolean(),
    })
    .strict(),
]);
export type FileRequest = z.infer<typeof fileRequestSchema>;

export const fileEntrySchema = z
  .object({
    name: z.string().max(1024),
    type: z.enum(['file', 'directory', 'symlink', 'other']),
    size: z.number().int().min(0),
    modifiedAt: z.string().max(64),
    mode: z.number().int().min(0).max(0o7777),
  })
  .strict();
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const fileResponseSchema = z
  .object({
    ok: z.boolean(),
    /** `not-found`, `exists`, `denied`, `too-large`, `failed`. */
    error: z
      .object({ code: z.string().max(32), message: z.string().max(1024) })
      .strict()
      .optional(),
    entries: z.array(fileEntrySchema).max(10_000).optional(),
    entry: fileEntrySchema.optional(),
    data: base64Chunk(LIVE_CHUNK_BYTES).optional(),
  })
  .strict();
export type FileResponse = z.infer<typeof fileResponseSchema>;

/** Debug tunnel (3.19): a TCP connection from the node to a replica's port, bridged through the control plane. */
export const tunnelOpenSchema = z
  .object({ replica: replicaIdSchema, port: z.number().int().min(1).max(65535) })
  .strict();
export const tunnelDataSchema = z.object({ data: base64Chunk(LIVE_CHUNK_BYTES) }).strict();
export const tunnelCloseSchema = z.object({ reason: z.string().max(256).optional() }).strict();
