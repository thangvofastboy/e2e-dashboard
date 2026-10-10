// Import first in tests that start a real server: the projects registry goes to a temp dir, not ~.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.E2E_DASHBOARD_HOME = mkdtempSync(join(tmpdir(), 'e2ed-home-'));
