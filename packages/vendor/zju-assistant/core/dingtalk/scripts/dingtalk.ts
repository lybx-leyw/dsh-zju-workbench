#!/usr/bin/env node
/**
 * Read-only DingTalk chat CLI. Runs on the Node that runs the skill (Electron's Node 24 as process.execPath with
 * ELECTRON_RUN_AS_NODE=1): node:crypto, node:sqlite and node:zlib are built in, so nothing is installed and no
 * Python or PowerShell is needed. Results and errors are one JSON object: { ok: true, … } or { ok: false, status, message }.
 * No credentials, plaintext database copies or query logs are written.
 */
import { main } from '../lib/cli.ts'

process.exitCode = main(process.argv.slice(2))
