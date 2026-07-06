import AstalWp from "gi://AstalWp"

const wp = AstalWp.get_default()
if (wp.audio) {
    // @ts-ignore
    const props = Object.getOwnPropertyNames(wp.audio.__proto__)
    console.log("AstalWp.Audio methods/properties:", props)
    
    // Check for streams, clients, etc.
    const keys = ["streams", "clients", "endpoints", "default_speaker", "default_microphone"]
    keys.forEach(k => {
        // @ts-ignore
        console.log(`${k}:`, wp.audio[k] ? "Exists" : "Missing")
    })
}
