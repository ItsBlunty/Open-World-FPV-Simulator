# sim CSV (time us, setpoint, gyro) to the npz layout step_response.py reads
import sys, numpy as np
d = np.genfromtxt(sys.argv[1], delimiter=',', names=True, deletechars='')
names = list(d.dtype.names); a = np.stack([d[k] for k in names], 1)
np.savez_compressed(sys.argv[2], a=a, names=np.array(names), headers=np.array([f'Craft name:{sys.argv[3]}', 'rollPID:sim', 'pitchPID:sim']))
