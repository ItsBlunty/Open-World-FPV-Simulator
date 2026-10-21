#!/bin/bash
# Step-response flights: Betaflight SITL (lock-step) and the built-in controller on the same physics and pilot.
SPW="$(dirname "$0")"
cd ~/owfpv-sitl/run-original
for sc in steps fast; do
  for v in 'plain:{}' 'delay:{"dead":4,"propInertia":1.5}'; do
    n=${v%%:*}; j=${v#*:}
    for fc in sitl builtin; do
      opts=$(node -e "const o=JSON.parse(process.argv[1]);o.fc='$fc';o.scenario='$sc';o.seconds=90;o.loopHz=4000;console.log(JSON.stringify(o))" "$j")
      if [ $fc = sitl ]; then (stdbuf -oL ./bf_ls > sitl.out 2>&1 &); sleep 1; fi
      timeout 900 node "$SPW/bridge.js" "$SPW/step4k_${sc}_${n}_${fc}.csv" "$opts" | grep -E "done|did not|armed"
      pkill -x bf_ls; sleep 0.5
    done
  done
done
