import { parseAllDocuments } from 'yaml';

/** A plaintext secret found in a pushed file: where and which rule — never the value itself. */
export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
}

interface TokenRule {
  rule: string;
  pattern: RegExp;
}

/** Known token formats (3.29 secret scanning on every push). */
const TOKEN_RULES: readonly TokenRule[] = [
  { rule: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { rule: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/ },
  { rule: 'github-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/ },
  { rule: 'gitlab-token', pattern: /\b(?:glpat|glptt|gldt|glrt|glsoat|glffct|glcbt|gloas)-[A-Za-z0-9_-]{20,}/ },
  { rule: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z2-7]{16}\b/ },
  { rule: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { rule: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/ },
  { rule: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { rule: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { rule: 'pypi-token', pattern: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/ },
  { rule: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}/ },
  { rule: 'openai-key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/ },
  { rule: 'sendgrid-key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { rule: 'twilio-key', pattern: /\bSK[0-9a-f]{32}\b/ },
  { rule: 'digitalocean-token', pattern: /\bdo[opr]_v1_[a-f0-9]{64}\b/ },
  { rule: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{32,}={0,2}/ },
  { rule: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

/** Keys (normalized to snake case) whose literal values are credentials (`password: …`, `API_TOKEN=…`). */
const CREDENTIAL_KEY =
  /(?:^|_)(?:pass|password|passwd|passphrase|pwd|secret|token|api_?key|private_?key|access_?key|secret_?key|client_?secret|auth_?key|credentials?|bearer)(?:$|_)/;

/** Keys that look credential-named but hold references, paths or settings (`PASSWORD_FILE`, `tokenUrl`). */
const NOT_A_VALUE_KEY =
  /_(?:file|path|url|uri|endpoint|ref|name|id|type|mode|version|length|ttl|expiry|expires|rotation|header|env|source|command|policy)$/;

/** `dbPassword` / `DB-PASSWORD` / `db.password` → `db_password`. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.-]+/g, '_')
    .toLowerCase();
}

/** `key: value`, `key=value`, `- KEY=value`, `"key": "value"`. */
const ASSIGNMENT = /^\s*(?:-\s+)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*(?::|=)\s*(.*)$/;

/** Literal `scheme://user:password@host` credentials (not placeholders). */
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:([^\s/@'"]+)@[^\s'"]+/i;

function placeholder(value: string): boolean {
  return /^(?:\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|<[^>]*>|\*+|x+|changeme|redacted|example|none|null|~)$/i.test(value);
}

/** Bits per character (Shannon). */
export function entropy(value: string): number {
  if (!value) return 0;

  const counts = new Map<string, number>();

  for (const c of value) counts.set(c, (counts.get(c) ?? 0) + 1);

  let bits = 0;

  for (const n of counts.values()) {
    const p = n / value.length;

    bits -= p * Math.log2(p);
  }

  return bits;
}

/** One SOPS-encrypted value, exactly (`ENC[AES256_GCM,data:…,iv:…,tag:…,type:…]`). */
const SOPS_VALUE = /^ENC\[AES256_GCM,data:[A-Za-z0-9+/=]*,iv:[A-Za-z0-9+/=]+,tag:[A-Za-z0-9+/=]+,type:[a-z]+\]$/;
const SOPS_VALUES = /ENC\[AES256_GCM,data:[A-Za-z0-9+/=]*,iv:[A-Za-z0-9+/=]+,tag:[A-Za-z0-9+/=]+,type:[a-z]+\]/g;

/** Whether a value is SOPS ciphertext, and nothing else. */
export function isSopsValue(value: string): boolean {
  return SOPS_VALUE.test(value);
}

/** Keys of SOPS metadata (sops 3.x); anything else in a `sops:` map is no SOPS metadata. */
const SOPS_METADATA_KEYS = new Set([
  'age',
  'pgp',
  'kms',
  'gcp_kms',
  'azure_kv',
  'hc_vault',
  'key_groups',
  'shamir_threshold',
  'lastmodified',
  'mac',
  'version',
  'encrypted_regex',
  'unencrypted_regex',
  'encrypted_suffix',
  'unencrypted_suffix',
  'encrypted_comment_regex',
  'unencrypted_comment_regex',
  'mac_only_encrypted',
]);

/** An age / PGP key entry whose `enc` is an armored envelope (not free text). */
function envelopeEntries(list: unknown, armor: string): boolean {
  return (
    list === undefined ||
    list === null ||
    (Array.isArray(list) &&
      list.every(
        (e) =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as { enc?: unknown }).enc === 'string' &&
          (e as { enc: string }).enc.trim().startsWith(`-----BEGIN ${armor}-----`),
      ))
  );
}

/**
 * Whether the whole file is SOPS-encrypted in earnest: every document that has a top-level `sops` map has real SOPS
 * metadata (only SOPS keys, the MAC as SOPS ciphertext, a version, armored age / PGP envelopes) — a hand-written
 * `sops:` block is no reason to skip scanning it.
 */
export function isSopsDocument(text: string): boolean {
  if (!/^sops:\s*$/m.test(text)) return false;

  try {
    const docs = parseAllDocuments(text);

    if (!Array.isArray(docs) || docs.some((d) => d.errors.length > 0)) return false;

    const values = docs.map((d) => d.toJS({ maxAliasCount: 0 }) as unknown);
    const sopsMaps = values
      .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'sops' in v)
      .map((v) => v['sops']);

    return (
      sopsMaps.length > 0 &&
      sopsMaps.every((m) => {
        if (!m || typeof m !== 'object' || Array.isArray(m)) return false;

        const meta = m as Record<string, unknown>;

        return (
          Object.keys(meta).every((k) => SOPS_METADATA_KEYS.has(k)) &&
          typeof meta['mac'] === 'string' &&
          isSopsValue(meta['mac']) &&
          (typeof meta['version'] === 'string' || typeof meta['version'] === 'number') &&
          envelopeEntries(meta['age'], 'AGE ENCRYPTED FILE') &&
          envelopeEntries(meta['pgp'], 'PGP MESSAGE')
        );
      })
    );
  } catch {
    return false;
  }
}

/** Values that are fine in Git: references, SOPS ciphertext, digests, public material, placeholders. */
function harmless(value: string): boolean {
  return (
    value === '' ||
    value.startsWith('secret://') ||
    isSopsValue(value) ||
    /^(?:sha256|sha384|sha512):[0-9a-f]{32,}$/i.test(value) ||
    /^(?:ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-\S+|sk-ssh-\S+|age1)[A-Za-z0-9 +/=@.-]*$/.test(value) ||
    value.startsWith('-----BEGIN CERTIFICATE') ||
    value.startsWith('-----BEGIN PUBLIC KEY') ||
    value.startsWith('/') ||
    /^(?:true|false|yes|no|on|off|\d+(?:\.\d+)?)$/i.test(value) ||
    /^https?:\/\/[^@\s]+$/i.test(value) ||
    placeholder(value) ||
    /^[|>][+-]?\d*$/.test(value)
  );
}

/** A literal, high-entropy credential value (≥ 12 chars, ≥ 3.3 bits / char, not a plain word or path). */
function looksLikeSecret(value: string): boolean {
  if (value.length < 12 || harmless(value)) return false;

  if (/\s/.test(value)) return false;

  // Mixed classes: lower / upper / digits / symbols; a single class (e.g. a word or a number) is not a credential.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;

  return classes >= 2 && entropy(value) >= 3.3;
}

function unquote(raw: string): string {
  const value = raw.replace(/\s+#.*$/, '').trim();
  const quoted = /^(["'])(.*)\1,?$/.exec(value);

  return (quoted ? quoted[2] : value.replace(/,$/, '')).trim();
}

function credentialKey(rawKey: string): boolean {
  const key = normalizeKey(rawKey);

  return CREDENTIAL_KEY.test(key) && !NOT_A_VALUE_KEY.test(key);
}

/** `key: value` pairs of flow maps / single-line JSON (`{"password": "…", "user": "x"}`). */
const INLINE_PAIR = /[{,]\s*["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,}\s]+)/g;

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

/** Top-level `kind: Secret` (a Kubernetes Secret manifest) in one YAML document. */
function isKubernetesSecret(lines: readonly string[]): boolean {
  return lines.some((l) => /^kind:\s*["']?Secret["']?\s*(?:#.*)?$/.test(l));
}

/** One line: token formats, URL credentials, credential-named assignments and inline pairs; a rule or null. */
function scanLine(line: string): string | null {
  // Exact SOPS values are ciphertext; everything else on the line is still scanned.
  const scrubbed = line.replace(SOPS_VALUES, 'ENC');

  for (const { rule, pattern } of TOKEN_RULES) if (pattern.test(scrubbed)) return rule;

  const url = URL_CREDENTIALS.exec(scrubbed);

  if (url && !placeholder(url[1]) && !url[1].startsWith('$')) return 'url-credentials';

  const assignment = ASSIGNMENT.exec(line);

  if (assignment && credentialKey(assignment[1]) && looksLikeSecret(unquote(assignment[2]))) return 'credential-value';

  if (line.includes('{'))
    for (const [, key, raw] of line.matchAll(INLINE_PAIR))
      if (credentialKey(key) && looksLikeSecret(unquote(raw))) return 'credential-value';

  return null;
}

/**
 * Scans one file for plaintext secrets: known token formats, private key blocks, credentials in URLs,
 * credential-named keys with literal high-entropy values (also as block scalars `key: |` and in flow maps / one-line
 * JSON), and the `data` / `stringData` values of Kubernetes Secrets. Secret references (`secret://`), values that
 * are exactly SOPS ciphertext (`ENC[…]`), image digests, public keys and certificates are fine. The `sops:` metadata
 * block is only skipped in files that really are SOPS-encrypted.
 */
export function scanForSecrets(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  const sops = isSopsDocument(text);
  // Per YAML document: is it a Kubernetes Secret (its data values are secrets whatever their keys)?
  const secretDocs: boolean[] = [];
  let doc: string[] = [];

  for (const line of [...lines, '---']) {
    if (/^---(?:\s|$)/.test(line)) {
      const secret = isKubernetesSecret(doc);

      doc.forEach(() => secretDocs.push(secret));
      secretDocs.push(false);
      doc = [];
    } else doc.push(line);
  }

  let inSopsBlock = false;
  /** Inside a top-level `data:` / `stringData:` map of a Kubernetes Secret. */
  let inSecretData = false;
  /** Inside a block scalar of a credential-named key: lines indented deeper than `indent` are its value. */
  let credentialBlock: { indent: number } | null = null;

  lines.forEach((line, index) => {
    const at = { file, line: index + 1 };
    const push = (rule: string) => findings.push({ ...at, rule });

    // Inside the SOPS metadata block the age / PGP envelopes are encrypted data keys, not secrets.
    if (sops && /^sops:\s*$/.test(line)) {
      inSopsBlock = true;

      return;
    }

    if (inSopsBlock) {
      if (/^\S/.test(line)) inSopsBlock = false;
      else return;
    }

    if (credentialBlock) {
      if (line.trim() === '' || indentOf(line) > credentialBlock.indent) {
        const rule = scanLine(line) ?? (looksLikeSecret(line.trim()) ? 'credential-value' : null);

        if (rule) push(rule);

        return;
      }

      credentialBlock = null;
    }

    if (/^(?:data|stringData):\s*(?:#.*)?$/.test(line)) {
      inSecretData = secretDocs[index] === true;

      return;
    }

    if (inSecretData) {
      if (/^\S/.test(line)) inSecretData = false;
      else {
        const entry = /^\s+["']?[A-Za-z0-9_.-]+["']?\s*:\s*(.*)$/.exec(line);
        const value = entry ? unquote(entry[1]) : '';

        if (entry && value && !/^[|>][+-]?\d*$/.test(value) && !placeholder(value) && !harmless(value)) {
          push('kubernetes-secret');

          return;
        }
      }
    }

    const rule = scanLine(line);

    if (rule) {
      push(rule);

      return;
    }

    // `password: |` / `token: >-`: the following, deeper indented lines are the value.
    const assignment = ASSIGNMENT.exec(line);

    if (assignment && /^[|>][+-]?\d*$/.test(unquote(assignment[2])) && credentialKey(assignment[1]))
      credentialBlock = { indent: indentOf(line) };
  });

  return findings;
}

/** Scans every file; findings ordered by file and line. */
export function scanFiles(files: readonly { path: string; text: string }[]): SecretFinding[] {
  return files.flatMap((f) => scanForSecrets(f.path, f.text));
}

/** The rejection reason of a push: file, line and rule per finding (at most 20), never the value. */
export function describeFindings(findings: readonly SecretFinding[]): string {
  const shown = findings.slice(0, 20).map((f) => `${f.file}:${f.line} (${f.rule})`);
  const more = findings.length > shown.length ? ` and ${findings.length - shown.length} more` : '';

  return `plaintext secrets found: ${shown.join(', ')}${more}; use secret references (secret://project/name) or SOPS`;
}
