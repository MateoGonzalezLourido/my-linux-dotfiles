#!/bin/bash
if pgrep -x wf-recorder > /dev/null; then
    pkill -INT wf-recorder
    notify-send "Grabación detenida"
else
    wf-recorder -f ~/Videos/$(date +%Y%m%d_%H%M%S).mp4 &
    notify-send "Grabando..."
fi
