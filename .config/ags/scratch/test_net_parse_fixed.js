
const out = `
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 63949280   98087    0    0    0     0          0         0 63949280   98087    0    0    0     0       0          0
  eno1:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
 wlan0: 475874490  437564    0    0    0     0          0         0 225049763  250069    0  172    0     0       0          0
`;

const lines = out.trim().split("\n");
lines.forEach(line => {
    if (line.includes("wlan") || line.includes("eth") || line.includes("enp") || line.includes("eno")) {
        const parts = line.replace(":", " ").trim().split(/\s+/);
        console.log("Line:", line.trim());
        console.log("Parts:", parts);
        const down = parseInt(parts[1]);
        const up = parseInt(parts[9]);
        console.log("Down:", down, "Up:", up);
    }
});
