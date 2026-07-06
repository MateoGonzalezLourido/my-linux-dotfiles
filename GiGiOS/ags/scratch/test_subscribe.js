import { qsView } from "./state.js"
console.log("qsView current:", qsView.get())
qsView.subscribe((v) => {
    console.log("qsView changed to:", v)
})
