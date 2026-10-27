/** Small local media utility invoked by Codex's normal command tool. */
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { synthesizeOffline } from './offline-tts.mjs';
const { positionals, values } = parseArgs({ allowPositionals: true, options: { text: { type: 'string' }, out: { type: 'string' }, sid: { type: 'string', default: '0' } } });
if (positionals[0] !== 'narrate' || !values.text || !values.out) {
  console.log('openfilm-local narrate --text "旁白文案" --out assets/audio/vo/line.wav [--sid 0]\nOffline simulated narration. Measure the resulting audio before trimming video.');
} else {
  console.log(JSON.stringify(await synthesizeOffline({ root: realpathSync(process.cwd()), text: values.text, out: values.out, sid: Number(values.sid) })));
}
