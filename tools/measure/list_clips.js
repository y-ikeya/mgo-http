const bytes = new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer())
const view = new DataView(bytes.buffer)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
for (const a of json.animations ?? []) {
  const times = a.samplers.map(s => json.accessors[s.input])
  const max = Math.max(...times.map(t => t.max?.[0] ?? 0))
  console.log(`${a.name}  ${max.toFixed(2)}s  ch=${a.channels.length}`)
}
