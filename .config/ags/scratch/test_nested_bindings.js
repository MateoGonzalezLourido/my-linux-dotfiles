import { Gtk } from "ags/gtk4"
import { createState } from "ags"

const [a, setA] = createState("A")
const [b, setB] = createState("B")

const label = new Gtk.Label({
    label: a((valA) => b((valB) => `${valA}${valB}`))
})

console.log("Initial label:", label.label)
setA("X")
console.log("After A=X:", label.label)
setB("Y")
console.log("After B=Y:", label.label)
