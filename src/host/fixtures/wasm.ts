// Minimal hand-rolled WASM module builders for the extension sandbox tests.
// The modules are assembled byte-by-byte (no toolchain in this repository) and
// cover the three sandbox behaviours: a no-op command, an infinite loop, and a
// module that writes to stdout through WASI fd_write.
//
// Section layout used below (in the order the binary format requires):
// type(1) import(2) func(3) memory(5) export(7) code(10) data(11)

function leb(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function section(id: number, body: number[]): number[] {
  return [id, ...leb(body.length), ...body];
}

function vec(items: number[][]): number[] {
  return [...leb(items.length), ...items.flat()];
}

function name(s: string): number[] {
  return [...leb(s.length), ...[...s].map((c) => c.charCodeAt(0))];
}

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
// type 0: () -> ()  |  type 1: (i32,i32,i32,i32) -> i32
const TYPE_EMPTY = [0x60, ...vec([]), ...vec([])];
const TYPE_FD_WRITE = [
  0x60,
  ...vec([[0x7f], [0x7f], [0x7f], [0x7f]]),
  ...vec([[0x7f]]),
];

function exportEntry(fieldName: string, kind: number, index: number): number[] {
  return [...name(fieldName), kind, ...leb(index)];
}

/** A valid WASI command whose _start does nothing and returns immediately. */
export function noopWasm(): Uint8Array {
  const body = [...vec([]), 0x0b]; // no locals, end
  return Uint8Array.from([
    ...HEADER,
    ...section(1, vec([TYPE_EMPTY])),
    ...section(3, vec([[0x00]])),
    ...section(5, vec([[0x00, ...leb(1)]])), // WASI requires an exported memory
    ...section(
      7,
      vec([exportEntry("_start", 0x00, 0), exportEntry("memory", 0x02, 0)]),
    ),
    ...section(10, vec([[...leb(body.length), ...body]])),
  ]);
}

/** A valid WASI command whose _start never returns (loop { br 0 }). */
export function spinWasm(): Uint8Array {
  const body = [
    ...vec([]),
    0x03,
    0x40, // loop (void)
    0x0c,
    0x00, // br 0 — forever
    0x0b, // end loop
    0x0b, // end function
  ];
  return Uint8Array.from([
    ...HEADER,
    ...section(1, vec([TYPE_EMPTY])),
    ...section(3, vec([[0x00]])),
    ...section(5, vec([[0x00, ...leb(1)]])), // WASI requires an exported memory
    ...section(
      7,
      vec([exportEntry("_start", 0x00, 0), exportEntry("memory", 0x02, 0)]),
    ),
    ...section(10, vec([[...leb(body.length), ...body]])),
  ]);
}

/**
 * A valid WASI command that writes `payload` to stdout with a single fd_write.
 * Memory layout: bytes 0..4 iov.ptr (=8), 4..8 iov.len, 8.. payload,
 * 24..28 nwritten scratch.
 */
export function writeWasm(payload: string): Uint8Array {
  const bytes = [...payload].map((c) => c.charCodeAt(0));
  const length = bytes.length;
  if (length > 0xffff) throw new Error("payload too long for this builder");
  const data = [
    0x08,
    0x00,
    0x00,
    0x00, // iov.ptr = 8
    ...leb24(length), // iov.len (u32 LE)
    ...bytes,
  ];
  const startBody = [
    ...vec([]),
    0x41,
    0x01, // i32.const 1        fd = stdout
    0x41,
    0x00, // i32.const 0        iovs base
    0x41,
    0x01, // i32.const 1        iovs_len
    0x41,
    0x18, // i32.const 24       nwritten out-pointer
    0x10,
    0x00, // call 0             fd_write (imported -> index 0)
    0x1a, // drop
    0x0b, // end
  ];
  const dataSegment = [
    0x00, // active, memory 0
    0x41,
    0x00,
    0x0b, // offset i32.const 0
    ...leb(data.length),
    ...data,
  ];
  return Uint8Array.from([
    ...HEADER,
    ...section(1, vec([TYPE_EMPTY, TYPE_FD_WRITE])),
    ...section(
      2,
      vec([[...name("wasi_snapshot_preview1"), ...name("fd_write"), 0x00, ...leb(1)]]),
    ),
    ...section(3, vec([[0x00]])),
    ...section(5, vec([[0x00, ...leb(1)]])), // 1-page memory
    ...section(
      7,
      vec([
        exportEntry("_start", 0x00, 0x01), // local func index 1 (import is 0)
        exportEntry("memory", 0x02, 0x00),
      ]),
    ),
    ...section(10, vec([[...leb(startBody.length), ...startBody]])),
    // Data segments are vec-encoded but not individually size-prefixed.
    ...section(11, vec([dataSegment])),
  ]);
}

// Four-byte little-endian u32 (payload lengths stay below 65536 here).
function leb24(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}
