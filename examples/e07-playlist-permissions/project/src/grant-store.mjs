import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const writeQueues = new Map();

const KEY_FIELDS = [
  'issuer',
  'subject',
  'clientId',
  'tenantId',
  'applicationId',
  'audience',
  'policyRevision',
];

export class JsonFileGrantStore {
  constructor(filePath) {
    if (process.env.NODE_ENV === 'production' || process.env.UAN_E07_TEST_MODE !== '1') {
      throw new Error('E07 JSON grants are a local test integration, not a production store.');
    }
    this.filePath = path.resolve(filePath);
  }

  // This fixture serializes writes within one process; it is not cross-process safe.
  async #withWriteLock(operation) {
    const previous = writeQueues.get(this.filePath) ?? Promise.resolve();
    const current = previous.then(operation);
    writeQueues.set(
      this.filePath,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return await current;
  }

  async find(query) {
    const grants = await this.#read();
    return grants.filter((grant) => KEY_FIELDS.every((key) => grant[key] === query[key]));
  }

  async save(grant) {
    return await this.#withWriteLock(async () => {
      const grants = await this.#read();
      if (grants.some((entry) => entry.grantId === grant.grantId)) {
        throw new Error('Grant IDs are immutable and cannot be saved twice.');
      }
      grants.push(structuredClone(grant));
      await this.#write(grants);
    });
  }

  // docs:start revoke-grant
  async revoke(grantId, revokedAt) {
    return await this.#withWriteLock(async () => {
      const grants = await this.#read();
      const grant = grants.find((entry) => entry.grantId === grantId);
      if (!grant || grant.revokedAt !== null) return false;
      grant.revokedAt = revokedAt;
      await this.#write(grants);
      return true;
    });
  }
  // docs:end revoke-grant

  async #read() {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const grants = JSON.parse(content);
      if (!Array.isArray(grants)) throw new Error('Grant file must contain an array.');
      return grants;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    }
  }

  async #write(grants) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = this.filePath + '.tmp-' + randomUUID();
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(grants, null, 2) + '\n');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
