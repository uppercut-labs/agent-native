import { appendFileSync } from 'node:fs';

export async function load(url, context, nextLoad) {
  if (process.env.E08_IMPORT_TRACE !== undefined) {
    appendFileSync(process.env.E08_IMPORT_TRACE, `${url}\n`);
  }
  return nextLoad(url, context);
}
