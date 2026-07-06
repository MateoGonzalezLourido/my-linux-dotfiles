import AstalWp from "gi://AstalWp"
const wp = AstalWp.get_default()
wp.audio.connect("speaker-added", (audio, endpoint) => {
    console.log("Speaker added!", endpoint.name, endpoint.id)
})
console.log("Listening for speakers...")
