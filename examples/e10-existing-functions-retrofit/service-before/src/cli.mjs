import { searchContent } from './content.mjs';

const [command, query, ...rest] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(message + '\n');
  process.exitCode = 2;
}

if (command !== 'content-search' && command !== 'search') {
  fail('usage: node src/cli.mjs <content-search|search> <query> [--limit N]');
} else if (rest.length !== 0 && (rest.length !== 2 || rest[0] !== '--limit')) {
  fail('usage: node src/cli.mjs <content-search|search> <query> [--limit N]');
} else {
  try {
    const limit = rest.length === 2 ? Number(rest[1]) : 5;
    process.stdout.write(JSON.stringify(searchContent({ query, limit })) + '\n');
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      fail(error.message);
    } else {
      throw error;
    }
  }
}
