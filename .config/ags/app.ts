import app from "ags/gtk4/app"
import style from "./style.scss"
import Bar from "./widget/Bar"
import PowerOptions from "./widget/bar/PowerOptions"

app.start({
  css: style,
  main() {
    app.get_monitors().flatMap(Bar)
    app.get_monitors().map(PowerOptions)
  },
})