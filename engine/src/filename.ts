import { access, mkdir, open } from 'node:fs/promises';
import { join, parse } from 'node:path';

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export const sanitizeFilename = (name: string): string => {
  let out = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  out = out.replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  out = out.replace(/[. ]+$/, '');
  if (out === '') return '';
  const stem = out.split('.')[0]!;
  if (RESERVED.test(stem)) out = `_${out}`;
  return out;
};

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const fromDisposition = (header: string | null): string[] => {
  if (!header) return [];
  const found: string[] = [];
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) found.push(safeDecode(star[2]!.trim()));
  const plain = /(?:^|[;\s])filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
  if (plain) found.push((plain[1] ?? plain[2] ?? '').trim());
  return found;
};

const lastPathPart = (url: string): string => {
  try {
    const parts = new URL(url).pathname.split('/');
    return safeDecode(parts[parts.length - 1] ?? '');
  } catch {
    return '';
  }
};

export const chooseFilename = (
  contentDisposition: string | null,
  finalUrl: string,
  originalUrl: string,
): string => {
  const candidates = [...fromDisposition(contentDisposition), lastPathPart(finalUrl), lastPathPart(originalUrl)];
  for (const candidate of candidates) {
    const clean = sanitizeFilename(candidate);
    if (clean !== '') return clean;
  }
  return 'download';
};

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const isTaken = async (dir: string, name: string): Promise<boolean> =>
  (await exists(join(dir, name))) || (await exists(join(dir, `${name}.part`)));

export const uniqueName = async (dir: string, filename: string): Promise<string> => {
  if (!(await isTaken(dir, filename))) return filename;
  const { name, ext } = parse(filename);
  for (let n = 1; ; n++) {
    const candidate = `${name} (${n})${ext}`;
    if (!(await isTaken(dir, candidate))) return candidate;
  }
};

// Picks a free name and claims it in one step by creating `<name>.part` with the 'wx' flag, which fails
// if the file exists. Two downloads choosing the same name at once can't both win, even across processes.
export const reserveName = async (dir: string, filename: string): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const { name, ext } = parse(filename);
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? filename : `${name} (${n})${ext}`;
    if (await exists(join(dir, candidate))) continue;
    try {
      await (await open(join(dir, `${candidate}.part`), 'wx')).close();
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
};
