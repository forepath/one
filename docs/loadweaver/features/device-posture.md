# Device Posture

[Remote access](./remote-access.md) clients can be held to posture requirements: core checks the device reports, results from your MDM and EDR, and a device certificate. A device that fails is **not disconnected**: it moves into the client group's `restrictedGroup`, and the device list and the device's own view show why.

```yaml
apiVersion: loadweaver.com/v1
kind: ClientGroup
metadata: { name: engineering }
spec:
  idpGroups: [engineering]
  posture:
    diskEncryption: true
    minOsVersion: { macos: '14.5', windows: '10.0.22631' }
    conditions:
      - mdm.compliant # every MDM that knows the device says compliant
      - edr.risk <= low # worst current EDR risk level
      - device.certificate.valid # company CA or the cluster CA
      - device.certificate.expiresInDays >= 7
  restrictedGroup: engineering-restricted
```

All requirements must hold. Anything unknown fails: no report, a report older than 24 hours, an integration that hasn't seen the device, a result older than the integration's `maxAgeMinutes`.

## Conditions

| Condition                                                       | Holds when                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mdm.compliant`                                                 | At least one MDM integration has a current `compliant` result for the device and none says `non-compliant`                            |
| `mdm.<integration>.compliant`                                   | That integration's current result is `compliant` (`edr.compliant` / `edr.<integration>.compliant` likewise: sensor healthy)           |
| `edr.risk <= low`                                               | The worst current risk level of the EDR integrations compares true (`low` < `medium` < `high`; operators `==` `!=` `<` `<=` `>` `>=`) |
| `edr.<integration>.risk < high`                                 | The same for one integration                                                                                                          |
| `device.certificate.valid`                                      | The last report carried a valid, unrevoked device certificate, bound to the device (see below)                                        |
| `device.certificate.expiresInDays >= 14`                        | The valid certificate expires in at least that many days                                                                              |
| `device.diskEncryption`, `device.firewall`, `device.screenLock` | Reported `true` (also `== false` / `!= true`)                                                                                         |
| `device.osVersion >= 14.5`, `device.appVersion >= 1.4`          | Version comparison, numeric per part                                                                                                  |
| `device.platform != linux`                                      | `macos`, `windows`, `linux`, `ios`, `android`                                                                                         |

Conditions are validated in plans. The older form `plugins: [{ type, require: compliant | low-risk }]` still works and reads the integration with that name (or, failing that, of that type).

## Integrations

Cluster admins connect MDMs and EDRs in the console (**Access › Device posture**) or with `POST /api/posture/integrations`. The configuration, including credentials, is stored encrypted; secrets are never returned (the API only names the fields that have a value), never logged, and never part of audit entries.

| Plugin        | Category | API used                                                                                                                                                                               | Credentials                                                                                                  | Result                                                                                                                                         |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `intune`      | MDM      | Microsoft Graph `GET /v1.0/deviceManagement/managedDevices` (global or US Gov cloud)                                                                                                   | Entra app registration, client credentials, application permission `DeviceManagementManagedDevices.Read.All` | `complianceState`: `compliant` / `inGracePeriod` → compliant, `noncompliant` / `conflict` / `error` → non-compliant, others unknown            |
| `jamf`        | MDM      | Jamf Pro `POST /api/oauth/token`, `GET /api/v1/computers-inventory` (sections GENERAL, HARDWARE, GROUP_MEMBERSHIPS)                                                                    | API client (role with "Read Computers")                                                                      | Compliant when managed, checked in within `maxCheckInDays` (14) and, if set, in the compliance smart group `complianceGroupId`                 |
| `kandji`      | MDM      | `GET /api/v1/devices`, `GET /api/v1/devices/{id}/status` for matched devices (US `<sub>.api.kandji.io`, EU `<sub>.api.eu.kandji.io`)                                                   | API token (device list + details)                                                                            | Non-compliant when MDM / agent is off, the device is missing, the blueprint isn't allowed, check-in is stale, or blueprint items fail          |
| `defender`    | EDR      | Defender for Endpoint `GET /api/machines` (documented global / regional hosts)                                                                                                         | Entra app registration, client credentials, WindowsDefenderATP permission `Machine.Read.All`                 | Risk from `riskScore` (and `exposureLevel`, unless `includeExposure=false`); non-compliant when the sensor isn't `Active` or not onboarded     |
| `crowdstrike` | EDR      | Falcon `POST /oauth2/token`, `GET /devices/queries/devices-scroll/v1`, `POST /devices/entities/devices/v2`, ZTA `GET /zero-trust-assessment/entities/assessments/v1` for matched hosts | API client (Hosts: Read, Zero Trust Assessment: Read); clouds us-1, us-2, eu-1, us-gov-1                     | Risk from the ZTA score (≥ 70 low, ≥ 40 medium, else high; configurable); contained hosts are high risk and non-compliant                      |
| `sentinelone` | EDR      | `GET /web/api/v2.1/agents` (cursor paging, optional `siteIds`)                                                                                                                         | API token of a service user (viewer)                                                                         | High risk with active threats or network quarantine, medium when outdated or a reboot is pending; non-compliant when inactive / decommissioned |

Further plugins come through `DYNAMIC_POSTURE_PLUGINS` (same loading as the other dynamic providers). A plugin declares its configuration fields, validates a configuration and returns the hosts it may call, and implements `testConnection`, `fetchDevices` and optionally `enrich`.

### Matching

Each integration matches vendor records to enrolled devices by `matchBy`, in order: `serial`, `deviceId` (Intune / Entra device id, Defender machine id, CrowdStrike AID, SentinelOne agent id or UUID) and `hostname` (first label, case-insensitive). Duplicate serials or ids are re-enrolments: the most recently seen record wins. Several records with the same hostname are ambiguous and give `unknown`.

- **Pinned identifiers**: a device's `deviceId`, `serialNumber` and `hostname` are normalized (device id lower-case, serial upper-case without placeholders such as `To Be Filled By O.E.M.`, hostname = lower-case first label) and pinned at its first report. Matching only uses pinned values, never an unpinned value from the latest report. Device id and serial are unique among valid (non-revoked, unexpired) clients — a second device reporting them is refused (`409`), a different device id / serial later is refused too (enroll again); partial unique indexes enforce this against concurrent first reports. A hostname another valid client already holds is just not pinned (no error; hostname matching then finds nothing for that device), and a pinned hostname stays when the device later reports another one.
- **Hostname is opt-in**: no plugin matches by hostname by default (Intune / Jamf / Kandji: `serial`, `deviceId`; SentinelOne / CrowdStrike: `deviceId`, `serial`; Defender: `deviceId`). Hostnames are self-reported and not unique, so an unmanaged laptop that reports `alice-mbp` could otherwise inherit Alice's verdict. An integration that adds `hostname` gets a warning (API `warnings`, console) — use it only together with the user match below.
- **User match (`requireUserMatch`)**: where the vendor record carries the device's user, the matched record's user must be the VPN client's owner (e-mail / UPN, case-insensitive), otherwise the result is `unknown` ("the device's user doesn't match the owner of this VPN client"). Default **on** for Intune (`userPrincipalName`, `emailAddress`), Jamf Pro (`USER_AND_LOCATION` e-mail or a UPN-style username) and Kandji (assigned user's e-mail); turning it off adds a warning. The EDR plugins (Defender, CrowdStrike, SentinelOne) don't support it — their records carry at most a last logged-in account name, not a verified owner (`requireUserMatch: true` is refused there). Machine clients are never user-matched (admins enroll them; they have no owning user). Owners without an e-mail (username only) can't satisfy a required user match (fail closed).
- **Recommendation**: require `device.certificate.valid` together with `mdm.compliant` (`conditions: ['mdm.compliant', 'device.certificate.valid']`). The MDM verdict says the managed device is healthy; the certificate (with proof of possession) ties the report to a key the managed device holds.

### Syncs

- A coordinator job runs every 2 minutes (`LOADWEAVER_POSTURE_SYNC_CRON`) and enqueues one sync per due integration with an idempotent job id. Integrations sync every `intervalMinutes` (30), and right away when a device reports new identifiers or an admin presses **Sync now**.
- A sync fetches the inventory once (paged, at most 2,000 requests per run, 20 s per request, 25 MB per response, 10 minutes per run), retries `429` / `5xx` up to 4 times honouring `Retry-After`, enriches only matched devices, and stores per device: status (`compliant` / `non-compliant` / `unknown`), risk level (`low` / `medium` / `high`), reasons, `checkedAt`, `staleAt`.
- A failing sync keeps the previous results until they reach `maxAgeMinutes` (1,440), then they count as unknown. Retries back off (interval × 2 per failure, at most 6 hours).
- Outbound calls go only to the hosts the configuration allows, over HTTPS, without following redirects; base URLs must be host names (no IP literals, credentials, queries).
- **Test connection** authenticates and reads one page; the answer never contains credentials.

## Device certificates

A posture report can carry a client certificate (`certificate.pem`) with a proof of possession: a signature over `loadweaver-posture-v1:<device id>:<timestamp>` made with the certificate's key, the timestamp within 5 minutes (ECDSA P-256 / P-384, raw or DER; RSA PKCS#1 v1.5 SHA-256).

- **Cluster CA**: `POST /api/vpn/devices/{id}/certificate` with a CSR generated on the device issues `spiffe://<cluster>.loadweaver/client/<device id>`, valid until the device key expires. Only the latest certificate of a device counts; revoking the device revokes it.
- **Company CA**: cluster admins upload a CA bundle (only CA certificates, up to 64) and CRLs. Chains may include intermediates from the bundle. A configured CRL of the issuer is checked; an outdated CRL fails the certificate.
- **Key usage**: a device certificate needs keyUsage `digitalSignature` (the proof of possession is a signature); when it has an extended key usage, it must include `clientAuth`. Without an EKU extension the certificate is accepted on its keyUsage alone (RFC 5280: no EKU = no restriction) — so a company CA's TLS server, code-signing or e-mail certificates (EKU without `clientAuth`) are not device certificates. Cluster-CA device certificates carry `clientAuth` only.
- **Revocation latency**: company-CA revocations take effect when the uploaded CRL lists them — Loadweaver doesn't fetch CRLs or ask OCSP. Re-upload the CRL after revoking (before its `nextUpdate`; an outdated CRL fails every certificate of that issuer), and keep in mind that a device's result is re-evaluated on its next report. Cluster-CA certificates are revoked instantly with the device.
- Trust settings (`GET` / `PUT /api/posture/certificates`): `trustClusterCa` (default on), `requireProof` (default on). Keep `requireProof` on: without it a copied certificate (public data) would satisfy `device.certificate.valid` on any device.

## Restricted groups and alerts

- Posture is evaluated on every report, after every sync, when an integration is deleted, and every minute for expiries. A device failing a group gets the group's `restrictedGroup` (which can't have posture requirements of its own) and the network is recompiled through the normal path: gateways, routes and policies follow.
- Every change of a device's effective groups is audited (`vpn.posture`, with the failing reasons and whether a report or an integration caused it). Integrations' changes are audited too (`posture.integration.*`, field names only).
- Built-in alerts: `builtin:device-restricted` (info, per restricted device with the reasons) and `builtin:posture-integration-failing` (warning, three failed syncs in a row). See [Alerting](./alerting.md).

## API

| Endpoint                                                                                                                                                                            | Who                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GET /posture/plugins`, `GET /posture/integrations`, `GET /posture/certificates`                                                                                                    | Infra operators, cluster admins (`cluster:read`) |
| `POST /posture/integrations`, `PATCH` / `DELETE /posture/integrations/{id}`, `POST …/{id}/test`, `POST …/{id}/sync`, `POST /posture/integrations/test`, `PUT /posture/certificates` | Cluster admins (`cluster:admin`)                 |
| `POST /vpn/devices/{id}/posture`, `POST /vpn/devices/{id}/certificate`                                                                                                              | The device owner, interactive login              |

## Clients

The report protocol (v1) is defined in `postureReportSchema` (util-model) and the OpenAPI spec, so the desktop and mobile apps can plug in. Until they ship, posture reports come from the API (or your own tooling); the core checks are self-reported, MDM / EDR results and device certificates are the independent sources.
