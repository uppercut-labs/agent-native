import type { ApplyResult } from './types.js';
import { byteLength } from './json.js';
import type { UiStore } from './store.js';
/** Incremental JSONL framing. A malformed frame stops this decoder, not the store. */
export class JsonlDecoder {
  private buffer: string = '';
  private stopped: boolean = false;
  public constructor(private readonly store: UiStore) {}
  public push(chunk: string): readonly ApplyResult[] {
    if (this.stopped)
      return [
        {
          kind: 'rejected',
          issue: { kind: 'integrity', message: 'Stream is closed. Create a new decoder.' },
        },
      ];
    let results: ApplyResult[] = [];
    const lines: string[] = chunk.split('\n');
    for (let i: number = 0; i < lines.length; i += 1) {
      this.buffer += lines[i] ?? '';
      if (byteLength(this.buffer) > this.store.limits.maxMessageBytes) {
        this.stopped = true;
        this.buffer = '';
        results.push({
          kind: 'rejected',
          issue: { kind: 'limit', message: 'JSONL frame exceeds its byte limit.' },
        });
        break;
      }
      if (i < lines.length - 1) {
        const line: string = this.buffer.trim();
        this.buffer = '';
        if (line.length === 0) continue;
        const result: ApplyResult = this.frame(line);
        results.push(result);
        if (result.kind === 'rejected') {
          this.stopped = true;
          break;
        }
      }
    }
    return results;
  }
  private frame(line: string): ApplyResult {
    try {
      return this.store.apply(JSON.parse(line) as unknown);
    } catch {
      return {
        kind: 'rejected',
        issue: { kind: 'invalid-message', message: 'Invalid or truncated JSONL frame.' },
      };
    }
  }
  public finish(): readonly ApplyResult[] {
    if (this.stopped) return [];
    this.stopped = true;
    const line: string = this.buffer.trim();
    this.buffer = '';
    return line.length > 0 ? [this.frame(line)] : [];
  }
}
