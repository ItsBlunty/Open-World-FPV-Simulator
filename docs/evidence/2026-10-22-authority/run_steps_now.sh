#!/bin/bash
# Step flights on the current Nazgul preset: Betaflight SITL (lock-step, 4 kHz, the "original" config: Betaflight
# defaults, D at peak, TPA off) and the built-in controller (same, TPA off), with and without the 4 ms ESC dead time.
SPW="$(cd "$(dirname "$0")" && pwd)"
cd ~/owfpv-sitl/run-original
for sc in steps fast; do
  for v in 'plain:{}' 'delay:{"dead":4}'; do
    n=${v%%:*}; j=${v#*:}
    for fc in sitl builtin; do
      opts=$(node -e "const o=JSON.parse(process.argv[1]);o.fc='$fc';o.scenario='$sc';o.seconds=90;o.loopHz=4000;o.simcore='$SPW/simcore-js/index.js';o.overrides={tpa:{mode:'D',rate:0,breakpoint:1350,lowRate:0,lowBreakpoint:1050,lowAlways:false}};console.log(JSON.stringify(o))" "$j")
      if [ $fc = sitl ]; then (stdbuf -oL ./bf_ls > sitl.out 2>&1 &); sleep 1; fi
      timeout 1200 node "$SPW/bridge.js" "$SPW/now_${sc}_${n}_${fc}.csv" "$opts" | grep -E "done|did not|armed|Error"
      pkill -x bf_ls; sleep 0.5
    done
  done
done
echo ALL DONE
