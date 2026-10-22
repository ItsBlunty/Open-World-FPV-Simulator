#!/bin/bash
# The owner's chop (sticks centred from the chop on), 16 motor spreads, 4 kHz, current Nazgul preset, 4 ms ESC dead time
# (bridge 'dead'), through Betaflight SITL ("original" config) and the built-in controller (same gains, TPA off).
SPW="$(cd "$(dirname "$0")" && pwd)"
cd ~/owfpv-sitl/run-original
node -e "let s=12345;const r=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648};for(let k=0;k<16;k++)console.log(JSON.stringify([0,1,2,3].map(()=>1+(r()*2-1)*0.025)))" > spreads.txt
for dead in 4 0; do
k=0
while read sp; do
  for fc in sitl builtin; do
    if [ $fc = sitl ]; then (stdbuf -oL ./bf_ls > sitl.out 2>&1 &); sleep 1; fi
    timeout 300 node "$SPW/bridge.js" "$SPW/chopd${dead}_${fc}_${k}.csv" "{\"fc\":\"$fc\",\"scenario\":\"chop\",\"seconds\":5.8,\"loopHz\":4000,\"dead\":$dead,\"asym\":$sp,\"simcore\":\"$SPW/simcore-js/index.js\",\"overrides\":{\"tpa\":{\"mode\":\"D\",\"rate\":0,\"breakpoint\":1350,\"lowRate\":0,\"lowBreakpoint\":1050,\"lowAlways\":false}}}" | grep -E "did not|Error"
    pkill -x bf_ls; sleep 0.3
  done
  k=$((k+1))
done < spreads.txt
done
echo finished
