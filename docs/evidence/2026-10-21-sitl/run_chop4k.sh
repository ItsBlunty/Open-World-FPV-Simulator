#!/bin/bash
# The owner's chop (sticks centred from the chop on) with 16 motor spreads, at 4 kHz, through Betaflight SITL and the
# built-in controller; the experiment copy of sim-core (K_ASYM) compiled to kick4k-js.
SPW="$(dirname "$0")"
cd ~/owfpv-sitl/run-original
node -e "let s=12345;const r=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648};for(let k=0;k<16;k++)console.log(JSON.stringify([0,1,2,3].map(()=>1+(r()*2-1)*0.025)))" > spreads.txt
k=0
while read sp; do
  for fc in sitl builtin; do
    if [ $fc = sitl ]; then (stdbuf -oL ./bf_ls > sitl.out 2>&1 &); sleep 1; fi
    timeout 300 node "$SPW/bridge.js" "$SPW/chop4k_${fc}_${k}.csv" "{\"fc\":\"$fc\",\"scenario\":\"chop\",\"seconds\":5.8,\"loopHz\":4000,\"asym\":$sp,\"simcore\":\"$SPW/kick4k-js/index.js\"}" | grep -E "did not"
    pkill -x bf_ls; sleep 0.3
  done
  k=$((k+1))
done < spreads.txt
echo finished $k
