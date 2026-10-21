export type PhaseRole = 'WC' | 'Co' | 'Gamma' | 'Eta' | 'Exclude';
export interface SourcePhase { id: number; name: string; symmetry: string; suggested: PhaseRole }

function suggested(name: string): PhaseRole {
  const base = name.toLowerCase().split(/[([]/)[0].replace(/[\s_(),-]/g, '');
  if (['wc', 'tungstencarbide', 'tungstenmonocarbide'].includes(base)) return 'WC';
  if (/^(co\b|cobalt\b)/i.test(name)) return 'Co';
  if (/eta|η|에타/i.test(name)) return 'Eta';
  return 'Gamma';
}

/** Read only the vendor header locally; measurement files are never sent elsewhere. */
export async function readSourcePhases(file: File): Promise<SourcePhase[]> {
  const buffer = await file.slice(0, 1024 * 1024).arrayBuffer();
  let phases: SourcePhase[] = [];
  if (file.name.toLowerCase().endsWith('.ang')) {
    const text = new TextDecoder().decode(buffer);
    let current: SourcePhase | undefined;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (!line.trimStart().startsWith('#')) break;
      const field = line.replace(/^\s*#\s*/, '');
      const id = /^Phase\s+(\d+)\s*$/i.exec(field);
      if (id) { current = { id: Number(id[1]), name: '', symmetry: '', suggested: 'Gamma' }; phases.push(current); }
      else if (current && /^MaterialName\s+/i.test(field)) current.name = field.replace(/^MaterialName\s+/i, '').trim();
      else if (current && /^Symmetry\s+/i.test(field)) current.symmetry = field.replace(/^Symmetry\s+/i, '').trim();
    }
  } else {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    const marker = [185, 11, 239, 255];
    const find = (kind: number) => {
      for (let i = 0; i <= bytes.length - 8; i++) {
        if (marker.every((value, j) => bytes[i + j] === value) && view.getUint32(i + 4, true) === kind) return i;
      }
      return -1;
    };
    const start = find(1), end = find(2);
    if (start < 0 || end <= start) throw new Error('OSC Phase 헤더를 읽지 못했습니다. Phase 직접 지정은 헤더가 있는 파일이 필요합니다.');
    for (let i = start + 8; i < end - 288; i++) {
      if (bytes[i] < 32 || bytes[i] >= 127) continue;
      let stop = i;
      while (stop < end && bytes[stop] !== 0 && stop - i <= 80) stop++;
      if (stop - i < 3 || stop - i > 80 || bytes[stop] !== 0) continue;
      const nameBytes = bytes.subarray(i, stop);
      if (!nameBytes.every(value => value >= 32 && value < 127)) continue;
      const name = new TextDecoder('ascii').decode(nameBytes);
      if (!/[a-z]/i.test(name)) continue;
      const symmetry = view.getInt32(i + 256, true);
      if (![1, 2, 3, 6, 20, 32, 43, 45, 62, 126, 131].includes(symmetry)) continue;
      const lengths = [260, 264, 268].map(offset => view.getFloat32(i + offset, true));
      const angles = [272, 276, 280].map(offset => view.getFloat32(i + offset, true));
      const bands = view.getInt32(i + 284, true);
      if (bands < 0 || bands >= 200 || !lengths.every(value => value > .5 && value < 30) || !angles.every(value => value > 50 && value < 150)) continue;
      phases.push({ id: phases.length + 1, name, symmetry: String(symmetry), suggested: suggested(name) });
      i += 287;
    }
  }
  phases = phases.filter(phase => phase.id > 0).map(phase => ({ ...phase, suggested: suggested(phase.name) }));
  if (!phases.length) throw new Error('Phase 정의를 찾지 못했습니다. 원본 파일의 Phase 헤더를 확인하세요.');
  return phases;
}
