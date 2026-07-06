import { createState } from "ags"

const [val, setVal] = createState({ nested: { foo: "bar" } })
const nested = val((s) => s.nested)
const mappedAs = nested.as((n) => n.foo)

console.log("mappedAs type:", typeof mappedAs)
try {
  mappedAs(() => {})
} catch (e) {
  console.error("Error calling mappedAs as function:", e)
}
