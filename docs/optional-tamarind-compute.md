# Optional Tamarind compute: design and personal setup

## Decision

GYDE remains usable with its existing Slivka deployment. A personal installation
can instead select Tamarind as its compute provider, using one API key stored on
the backend. The frontend discovers the provider at runtime; it contains no key
and needs no Tamarind-specific build, Clerk application, or second login.

This contribution also includes generally useful dataset-action feedback, column
renaming, structure-loading fixes, independent residue mappings for identical
chains, and job/result error handling. These improvements work with the ordinary
GYDE backend. Tamarind-specific input forms and scientific result mappings are
selected only when the backend reports the Tamarind provider.

## Boundaries

```text
Browser on the user's computer
  GYDE workspace, table and structure UI
  optional Tamarind forms/result mapping
             |
             | same-origin requests, no Tamarind credentials
             v
Local GYDE server (loopback only)
  existing GYDE workspace storage in MongoDB
  optional Tamarind router + persistent job records
  one API key from environment or a private local file
             |
             | HTTPS, x-api-key, fixed API origin
             v
Tamarind API
  account permissions, projects, tool policy, budgets and billing
             |
             | signed upload/download destinations, without the API key
             v
Tamarind object storage
```

The backend adapter implements GYDE's existing service/job/file contract. This
keeps Slivka behavior intact and gives a later provider an existing contract to
implement. `GET /compute/config` returns only `{ "provider": "slivka" }` or
`{ "provider": "tamarind" }`. The browser waits for this configuration before
mounting the application. A 404 permits an older GYDE server; other configuration
errors stop initialization instead of silently selecting a different provider.

Tamarind code lives in `gydesrv/integrations/tamarind` and
`gyde-frontend/src/integrations/tamarind`. Core analysis code selects the adapter
through `isTamarindCompute()`. This first version selects **one compute provider
per installation**, rather than mixing Slivka and Tamarind in the same dataset.
The runtime selector is a configuration mechanism, never an authorization check.

The Tamarind-hosted product remains a separate deployment: its Clerk sign-in,
PostgreSQL workspace store, organization sharing, release flags, website-embedded
forms, infrastructure, and deployment credentials are not needed here. The
personal integration does not call the hosted `/gyde/identity` endpoint and is
not subject to that portal's organization-only rollout flag. Ordinary Tamarind
API account eligibility and organization policies still apply.

## Authentication and security

The local GYDE user is the existing `GYDE_MOCK_USER` identity. In this personal
mode it represents the sole person using their own computer; it is not a
Tamarind authentication bypass. Every remote request is authenticated by the
configured Tamarind key. A key connects an existing account, not a new identity.

Connecting accounts is feasible without giving a user extra platform privileges.
Nevertheless, accepting a key makes the installation capable of spending that
account's allowance. A compromised key has all the rights Tamarind grants it,
which may be broader than this adapter's limited operations. Use a dedicated key
where your account supports one; revoke it in Tamarind if compromised. Local
administrators and malicious software on the computer remain within the trust
boundary. This is not a sandbox against other local processes.

Controls in this version:

- Disabled by default; no Tamarind credential is needed for Slivka.
- One backend credential, read at startup. Never a `REACT_APP_*` secret, browser
  storage credential, workspace field, URL parameter, or returned API payload.
- Official production or staging API origin only, HTTPS with certificate checks.
  Caller-supplied destinations, identity headers and cookies are not forwarded.
- Personal mode refuses wildcard/public bind addresses, OIDC/shared login and
  disabled TLS verification. Use the exact loopback origin shown in setup.
- All local routes check the socket peer, Host, Origin and browser fetch-site
  headers. Cross-site requests and DNS-rebinding Host values are rejected.
  Writes require the configured Origin, or `X-Gyde-Local: 1` for local CLI use.
- Result storage destinations are restricted to HTTPS S3/CloudFront hosts returned
  by authenticated API calls. Requests never forward the API key to storage and
  never follow redirects. Result paths come from the adapter's validated listing,
  not arbitrary browser file paths or URLs.
- Upload size (20 MiB), result body size (50 MiB), active request counts, directory
  traversal and file inventories are bounded. Upstream error bodies are not
  echoed because they may contain secrets, signed URLs or scientific input data.
- Each local job is scoped to a one-way fingerprint of the configured credential
  and origin. The router exposes only jobs submitted through this installation,
  not arbitrary jobs or account files. Normal Tamarind authorization independently
  applies to all remote calls.

Changing/revoking the key requires a server restart. Changing its value gives a
new local job-history scope, even if it belongs to the same account. Previously
imported data remains in the workspace, and existing remote runs remain visible
in Tamarind. Revoking a key does not cancel already running compute. There is no
credential management endpoint or browser key-entry form.

Do not expose or reverse-proxy this mode onto a LAN/public address, share the
machine as a multi-user service, or configure an administrator's key for a group.
For shared installations, future work must explicitly design per-user connection
storage, account/organization selection, delegated scopes, revocation, result
sharing and billing attribution. OAuth authorization code with PKCE is a likely
connection flow; reusing a hosted browser session across arbitrary installations
is not an implementation of that flow.

## Personal setup

Use Node.js 22 or later and an existing local GYDE MongoDB installation configured
as a replica set (a single-node replica set is sufficient). Workspace updates use
MongoDB transactions; a standalone MongoDB server cannot save those updates. No Slivka
server/GPU installation, Clerk configuration or PostgreSQL is required for this
mode. The normal Slivka setup remains documented in the main README.

1. Sign into your own Tamarind account and create/retrieve an API key from its API
   settings. Account access, available tools and charges are governed by Tamarind.
2. Store the key in a file outside this repository, with permissions `0600` on
   macOS/Linux (`chmod 600 /absolute/path/to/tamarind-key`). The file contains only
   the key. Do not place it in a frontend environment file or commit it.
3. Install dependencies and build the standard frontend:

   ```sh
   npm ci --prefix gydesrv
   npm ci --prefix gyde-frontend --ignore-scripts
   npm run build --prefix gyde-frontend
   ```

4. From `gydesrv`, copy `.env.example` to `.env` and set the absolute key-file path
   and MongoDB URL. The example is:

   ```dotenv
   GYDE_COMPUTE_PROVIDER=tamarind
   GYDE_HOST=127.0.0.1
   GYDE_PORT=3030
   GYDE_MOCK_USER=personal
   GYDE_MONGO_CONNECTION=mongodb://127.0.0.1:27017/
   GYDE_DB_NAME=gyde_personal
   GYDE_STATIC_DIR=../gyde-frontend/build
   TAMARIND_API_KEY_FILE=/absolute/path/to/tamarind-key
   TAMARIND_ORIGIN=https://app.tamarind.bio
   ```

   `TAMARIND_API_KEY` is an alternative for an existing secret manager; do not
   configure both credential sources. If your organization requires a project,
   also set `TAMARIND_PROJECT_ID=proj_...` to an existing authorized project. The
   adapter does not create projects or bypass project requirements.

5. Start the server and open **http://127.0.0.1:3030** (not `localhost`, which is a
   different origin under the strict Host check):

   ```sh
   cd gydesrv
   node --env-file=.env index.js
   ```

6. Read the compute notice and continue. It explains that selected inputs leave
   the computer and jobs use the configured account. GYDE can automatically align
   unaligned imports with MAFFT, so this notice appears before mounting datasets
   and triggering analysis. It appears again after a full page reload.

This initial setup intentionally runs the GYDE Node server directly on the user's
computer. The existing Docker image binds `0.0.0.0` and disables TLS verification;
personal Tamarind mode refuses those settings. The existing Docker/Slivka setup
is unaffected. A dedicated secured personal container recipe is separate work.
The frontend development mock server (`npm start`) is also not the personal
compute backend; use the built frontend served by `gydesrv` for this mode.

## Tools and UI

The contributed adapters cover MAFFT, ANARCI, TAP, ThermoMPNN, ProteinMPNN,
LigandMPNN, Boltz-2, AlphaFold2, Chai-1, OpenFold3 and ABodyBuilder2/3. Their
existing GYDE actions use the appropriate Tamarind input/output mapping. Service
discovery exposes implemented adapters, not a promise that the connected account
has permission or budget for every tool. Tamarind decides on submission.

Adapters validate supported inputs and reject unsupported settings. They retain
scientific distinctions: MAFFT is Tamarind's fast mode (not a promise of the
legacy service's exact version), models have provider-specific outputs, ANARCI
uses one sequence per job, and residue-index mappings must remain exact. The
Slivka service ID is a compatibility identifier, not a claim of identical model
versions. Restrictions live beside each adapter's description and validation.
Unmapped licensed tools and workflows remain unavailable.

The forms run inside GYDE. They do not embed the Tamarind website or require a
Tamarind browser session. Job status distinguishes queueing, running, cancelling,
reconnecting, reconciliation and importing. **Recent compute jobs** shows the
latest 100 local jobs, refreshes status, permits cancellation, and exposes result
file downloads after completion. Imported data stays in the local workspace;
changing provider does not transfer the workspace to Tamarind.

## Submission, recovery and results

1. Validate the form before uploading or spending compute.
2. Insert a job record with a unique request key and generated Tamarind job name.
   MongoDB's unique index serializes retries across requests/processes.
3. Upload only the required files. Persist dispatch intent, then submit once.
4. On a timeout/uncertain response, look up the saved job name. Never automatically
   repeat a potentially paid POST. Missing remote jobs remain in reconciliation
   until the owner checks them; no timeout silently creates a replacement run.
5. Browser retries retain an ambiguous request's key using hashes of its inputs
   in sessionStorage. After a lost response the browser first performs a read-only
   request lookup. A server restart also recovers from persisted records.
6. Poll with bounded requests. Completed result reads can retry transient failures
   without resubmitting compute. Files must belong to the persisted job and match
   the adapter's expected output contract/version.

Browser submissions are queued at a maximum of two at once, matching the upload
admission limit. Disconnecting a browser does not free backend capacity until its
remote work settles.

Only completed matching jobs in the configured project can satisfy a cache request. Result access is checked
again with Tamarind, so a local cache entry does not bypass key revocation. A
recovered job is never automatically resubmitted just because import failed.
Switching compute providers can make pending provider-specific jobs unavailable
locally; finish/import them before switching, or manage them in Tamarind. Jobs'
canonical result URLs use `/compute/tamarind`, distinguishing them from Slivka.

## Validation and contribution plan

Run `npm test --prefix gydesrv` and
`CI=true npm test --prefix gyde-frontend -- --watchAll=false --runInBand`, then
`npm run build --prefix gyde-frontend`. Set `GYDE_TEST_MONGO_URL` to an isolated
test MongoDB to include the actual database concurrency/restart test. That test
creates and drops only a randomly named `gyde_test_*` database. Never use a
production database for tests. The CI workflow starts its own MongoDB service.

Tests cover disabled-mode configuration, request-origin restrictions, credential
handling, transfer limits, API shapes, output paths, job ownership, duplicate and
uncertain submission, real MongoDB uniqueness/restart recovery, scientific
transformations and UI behavior. All test API clients use synthetic credentials;
tests do not launch real paid jobs or establish live scientific equivalence.

Before treating a release as scientifically validated, run a live account smoke
test for upload → submit → poll → result → import, rejection on an invalid/revoked
key and cancellation, then representative acceptance cases for each enabled
scientific mapping. Verify the intended account/project and current tool schema.
An organization-required project should be tested both missing and configured.

Review the work in two parts: general UI improvements with Slivka compatibility,
then optional provider wiring, backend credential handling and compute forms.
There is no need to upstream hosted infrastructure or require upstream users to
adopt Tamarind accounts. Future providers can implement the same job contract;
shared deployments and per-user OAuth connections should be separate changes.

API reference: https://app.tamarind.bio/api-docs/overview
