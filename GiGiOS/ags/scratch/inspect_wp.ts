import AstalWp from "gi://AstalWp"

const wp = AstalWp.get_default()
if (wp.audio) {
    console.log("Audio available")
    // @ts-ignore
    console.log("Properties:", Object.keys(wp.audio))
    // Check if streams exists
    // @ts-ignore
    if (wp.audio.streams) {
        console.log("Streams available")
    }
} else {
    console.log("Audio not available")
}
