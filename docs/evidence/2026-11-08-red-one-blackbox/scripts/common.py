import numpy as np
from scipy.signal import butter, filtfilt
POLES=14; MASS=0.700; G=9.81
def load(base, li):
    z=np.load(f"{base}_log{li}.npz"); a=z["data"]; names=list(z["names"])
    c=lambda k: a[:,names.index(k)]
    d={}
    d["t"]=(c("time")-c("time")[0])/1e6
    d["thr"]=c("rcCommand[3]")
    d["V"]=c("vbatLatest")/100; d["I"]=c("amperageLatest")/100
    d["cmd"]=np.stack([(c(f"motor[{i}]")-48)/(2047-48) for i in range(4)],1)
    d["rpm"]=np.stack([c(f"eRPM[{i}]")*100/(POLES/2) for i in range(4)],1)
    d["gyro"]=np.stack([c(f"gyroADC[{i}]") for i in range(3)],1)*np.pi/180
    d["acc"]=np.stack([c(f"accSmooth[{i}]") for i in range(3)],1)/2048*G
    d["sp"]=np.stack([c(f"setpoint[{i}]") for i in range(3)],1)
    return d
def lp(x, hz, fs=1968.0, order=2):
    b,a=butter(order, hz/(fs/2)); return filtfilt(b,a,x,axis=0)
