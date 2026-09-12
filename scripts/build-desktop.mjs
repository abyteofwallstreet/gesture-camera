import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
// Encoded flags preserve spaces in source paths and apply to dependencies too.
// Removing debug symbols alone does not remove Rust panic/source locations.
if(process.env.RUSTFLAGS&&!process.env.CARGO_ENCODED_RUSTFLAGS){
  throw new Error('Use CARGO_ENCODED_RUSTFLAGS for custom release flags so build-path redaction can preserve them exactly.');
}
const flags=(process.env.CARGO_ENCODED_RUSTFLAGS||'').split('\x1f').filter(Boolean);
const roots=new Map();
for(const [source,target] of [[homedir(),'/build/home'],[tmpdir(),'/build/tmp'],[root,'/build/gesture-camera']]){
  roots.set(source.replace(/\/$/,''),target);
  roots.set(realpathSync(source).replace(/\/$/,''),target);
}
for(const [source,target] of roots)flags.push(`--remap-path-prefix=${source}=${target}`);
const cli=path.join(root,'node_modules/.bin/tauri');
const result=spawnSync(cli,['build','--bundles','app',...process.argv.slice(2)],{
  cwd:root,stdio:'inherit',env:{...process.env,CARGO_ENCODED_RUSTFLAGS:flags.join('\x1f')}
});
if(result.error)throw result.error;
process.exit(result.status??1);
