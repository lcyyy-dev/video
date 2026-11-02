// Migration only. Runtime logging and queries do not use JSONL files.
import {readdirSync, createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
export async function* legacyEvents(directory) {
  const names=readdirSync(directory).filter(name=>/^\d{4}-\d{2}-\d{2}\.(gateway|monitor|tunnel|admin)\.jsonl(?:\.[1-4])?$/.test(name)).sort();
  for(const name of names){
    const stream=createInterface({input:createReadStream(join(directory,name)),crlfDelay:Infinity});
    for await(const line of stream){if(!line.trim())continue;try{const row=JSON.parse(line);if(row&&typeof row==='object')yield row;}catch{/* Ignore only an incomplete legacy line. */}}
  }
}
