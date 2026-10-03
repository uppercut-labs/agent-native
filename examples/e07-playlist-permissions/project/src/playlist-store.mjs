import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonFilePlaylistStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
  }

  async listPublic() {
    return (await this.#read()).filter((playlist) => playlist.visibility === 'public');
  }

  async get(playlistId) {
    return (await this.#read()).find((playlist) => playlist.id === playlistId) ?? null;
  }

  async edit(playlistId, title) {
    const playlists = await this.#read();
    const playlist = playlists.find((entry) => entry.id === playlistId);
    if (!playlist) return null;
    playlist.title = title;
    await this.#write(playlists);
    return playlist;
  }

  async delete(playlistId) {
    const playlists = await this.#read();
    const next = playlists.filter((entry) => entry.id !== playlistId);
    if (next.length === playlists.length) return false;
    await this.#write(next);
    return true;
  }

  async #read() {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        const fixture = [
          { id: 'playlist-a', tenantId: 'tenant-a', title: 'Alice mix', visibility: 'private' },
          {
            id: 'playlist-a-delete',
            tenantId: 'tenant-a',
            title: 'Alice archive',
            visibility: 'private',
          },
          {
            id: 'playlist-a-revoked',
            tenantId: 'tenant-a',
            title: 'Must survive revocation',
            visibility: 'private',
          },
          { id: 'playlist-b', tenantId: 'tenant-b', title: 'Bob mix', visibility: 'private' },
          {
            id: 'playlist-public',
            tenantId: 'public',
            title: 'Sample collection',
            visibility: 'public',
          },
        ];
        await this.#write(fixture);
        return fixture;
      }
      throw error;
    }
  }

  async #write(playlists) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = this.filePath + '.tmp-' + randomUUID();
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(playlists, null, 2) + '\n');
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
