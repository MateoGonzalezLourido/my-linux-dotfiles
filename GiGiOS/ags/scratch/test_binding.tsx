import { createState, For } from "ags"

const [devs, setDevs] = createState([{name: "A", paired: true}, {name: "B", paired: false}])

const pairedDevs = devs((ds) => ds.filter(d => d.paired))

console.log("pairedDevs is a binding?", typeof pairedDevs === "function" || typeof pairedDevs === "object")
