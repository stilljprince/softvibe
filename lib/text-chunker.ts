// lib/text-chunker.ts
export function chunkByChars(input: string, min = 2200, max = 2900): string[] {
  const text = (input ?? "").trim();
  if (!text) return [];

  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let cur = "";

  const pushCur = () => {
    const c = cur.trim();
    if (c) chunks.push(c);
    cur = "";
  };

  for (const p of paras) {
    // wenn ein Absatz alleine zu lang ist -> hard split
    if (p.length > max) {
      if (cur) pushCur();
      for (let i = 0; i < p.length; i += max) {
        chunks.push(p.slice(i, i + max).trim());
      }
      continue;
    }

    if (!cur) {
      cur = p;
      continue;
    }

    if ((cur.length + 2 + p.length) <= max) {
      cur += "\n\n" + p;
      continue;
    }

    // cur wäre zu groß, also pushen, aber min beachten
    if (cur.length < min) {
      // notfalls trotzdem pushen – v3 Limit ist wichtiger
      pushCur();
      cur = p;
    } else {
      pushCur();
      cur = p;
    }
  }

  if (cur) pushCur();
  return chunks;
}