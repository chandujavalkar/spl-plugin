import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';
export function redactSecrets(s:string){return s.replace(/((?:password|passwd|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key)\s*[:=]\s*)(["']?)([^"'\s]+)\2/gi,'$1$2[REDACTED]$2').replace(/(Authorization\s*:\s*)(Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi,'$1[REDACTED]').replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]')}
export async function readText(p:string,max:number){const b=await fs.readFile(p);return redactSecrets(b.subarray(0,max).toString('utf8'))}
export async function fingerprint(entries:any[]){const h=crypto.createHash('sha256');for(const e of entries.sort((a,b)=>a.path.localeCompare(b.path)))h.update(`${e.path}|${e.size}|${e.mtimeMs}\n`);return h.digest('hex')}
export function rel(root:string,p:string){return path.relative(root,p).replace(/\\/g,'/')}
export const binary=new Set(['.png','.jpg','.jpeg','.gif','.webp','.pdf','.zip','.jar','.war','.class','.dll','.so','.dylib','.exe','.bin','.mp4']);
