// Free price check: reading a 402 costs nothing. Also a cheap liveness probe of the
// endpoint — but NOT proof the subgraph exists, since a bogus id returns the same
// challenge (measured).
import { quote } from './fetch.js';

const r = await quote();
console.log(JSON.stringify(r, null, 2));
// `process.exit` truncates piped stdout — the JSON above can be cut off when the
// output goes through a pipe. Setting exitCode lets the process end on its own with
// everything flushed. (Seen for real: `npm run quote | head` printed a torn result.)
process.exitCode = r.ok ? 0 : 1;
