// Incremental SSE parser. Feed raw chunks; harvest complete `data:` payloads.
// State is a plain record (full shape); no classes needed.

export interface SseParser {
  buffer: string;
  dataLines: string[];
}

export function newSseParser(): SseParser {
  return { buffer: "", dataLines: [] };
}

// Returns completed `data:` payloads found in `chunk` (joined multi-line
// data fields). Handles events split across chunks.
export function sseFeed(p: SseParser, chunk: string): string[] {
  p.buffer = p.buffer + chunk;
  const events: string[] = [];
  for (;;) {
    const sep = p.buffer.indexOf("\n\n");
    if (sep < 0) {
      break;
    }
    const rawEvent = p.buffer.slice(0, sep);
    p.buffer = p.buffer.slice(sep + 2);
    p.dataLines = [];
    const lines = rawEvent.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("data:")) {
        let d = line.slice(5);
        if (d.startsWith(" ")) {
          d = d.slice(1);
        }
        p.dataLines.push(d);
      }
    }
    if (p.dataLines.length > 0) {
      let joined = "";
      for (let i = 0; i < p.dataLines.length; i++) {
        if (i > 0) {
          joined = joined + "\n";
        }
        joined = joined + p.dataLines[i];
      }
      events.push(joined);
    }
  }
  return events;
}
