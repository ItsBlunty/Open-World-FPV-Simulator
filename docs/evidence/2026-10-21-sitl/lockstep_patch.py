# Adds a lock-step mode (OWFPV_LOCKSTEP) to Betaflight 2026.6.2's SITL (src/platform/SIMULATOR/sitl.c).
# Usage: python3 lockstep_patch.py <betaflight checkout>
import sys

p = sys.argv[1] + "/src/platform/SIMULATOR/sitl.c"
s = open(p).read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)


rep('#include "sensors/sensors.h"\n', '''#include "sensors/sensors.h"
#ifdef OWFPV_LOCKSTEP_DEBUG
#include "flight/mixer.h"
#include "sensors/gyro.h"
#include "fc/tasks.h"
#endif
''')

rep("static const char *configFilePath = NULL;\n", """static const char *configFilePath = NULL;

#ifndef OWFPV_LOCKSTEP
#define OWFPV_LOCKSTEP 0
#endif
// the lock-step period, us: one boundary per simulator physics step (250 at 4 kHz, the same as the gyro rate set
// with VIRTUAL_GYRO_SAMPLE_RATE_HZ so each gyro / PID loop gets a fresh sample)
#ifndef OWFPV_LOCKSTEP_RC_US
#define OWFPV_LOCKSTEP_RC_US 2000
#endif
#ifndef OWFPV_LOCKSTEP_US
#define OWFPV_LOCKSTEP_US 1000
#endif
#if OWFPV_LOCKSTEP
// Lock-step with an external simulator (Open World FPV Simulator, 2026-10-21): the clock is virtual and moves only
// as the firmware runs (OWFPV_LOCKSTEP_READ_NS per cycle-counter read, so polling costs little virtual time; delays by
// their length). At every boundary (OWFPV_LOCKSTEP_US) the firmware
// sends the motor outputs of the period that ended, then blocks for the simulator's next rc_packet and
// fdm_packet (sent in that order, each with a larger timestamp), so every run with the same inputs is identical.
#ifndef OWFPV_LOCKSTEP_READ_NS
#define OWFPV_LOCKSTEP_READ_NS 20
#endif
static uint64_t lsNowNs = 0;
static uint64_t lsLimitNs = 0;
static bool lsStarted = false;
static double lsLastTs = -1.0;
static void lsBoundary(void);
static void lsAdvanceNs(uint64_t ns)
{
    lsNowNs += ns;
    while (lsNowNs >= lsLimitNs) {
        lsBoundary();
    }
}
#endif
""")

rep("""    if (realtime_now > last_realtime + 500*1e3) { // 500ms timeout""",
    """    if (!OWFPV_LOCKSTEP && realtime_now > last_realtime + 500*1e3) { // 500ms timeout""")

rep("""    ret = pthread_create(&udpWorker, NULL, udpThread, NULL);""", """#if OWFPV_LOCKSTEP
    (void)udpThread; (void)udpRCThread;
    printf("[SITL] lock-step mode: rc_packet then fdm_packet per 1 ms, motors sent at each boundary\\n");
    return;
#endif
    ret = pthread_create(&udpWorker, NULL, udpThread, NULL);""")

rep("""uint64_t micros64(void)
{""", """uint64_t micros64(void)
{
#if OWFPV_LOCKSTEP
    return lsNowNs / 1000;
#endif""")

rep("""uint64_t millis64(void)
{""", """uint64_t millis64(void)
{
#if OWFPV_LOCKSTEP
    return lsNowNs / 1000000;
#endif""")

rep("""uint32_t getCycleCounter(void)
{""", """uint32_t getCycleCounter(void)
{
#if OWFPV_LOCKSTEP
    lsAdvanceNs(OWFPV_LOCKSTEP_READ_NS);
    return (uint32_t)((lsNowNs / 1000) & 0xFFFFFFFF);
#endif""")

rep("""void delayMicroseconds(uint32_t us)
{""", """void delayMicroseconds(uint32_t us)
{
#if OWFPV_LOCKSTEP
    lsAdvanceNs((uint64_t)us * 1000);
    return;
#endif""")

rep("""void delay(uint32_t ms)
{""", """void delay(uint32_t ms)
{
#if OWFPV_LOCKSTEP
    lsAdvanceNs((uint64_t)ms * 1000000);
    return;
#endif""")

rep("""    // get one "fdm_packet" can only send one "servo_packet"!!""", """#if OWFPV_LOCKSTEP
    return;
#endif
    // get one "fdm_packet" can only send one "servo_packet"!!""")

s += """
#if OWFPV_LOCKSTEP
static void lsBoundary(void)
{
    if (lsStarted) {
        udpSend(&pwmLink, &pwmPkt, sizeof(servo_packet));
        udpSend(&pwmRawLink, &pwmRawPkt, sizeof(servo_packet_raw));
    }
    rc_packet rc;
    fdm_packet f;
    do {
        while (udpRecv(&rcLink, &rc, sizeof(rc), 1000) != (int)sizeof(rc)) { }
    } while (rc.timestamp <= lsLastTs);
    do {
        while (udpRecv(&stateLink, &f, sizeof(f), 1000) != (int)sizeof(f)) { }
    } while (f.timestamp <= lsLastTs);
    lsLastTs = f.timestamp;
    // the radio link delivers a frame every OWFPV_LOCKSTEP_RC_US (2000: 500 Hz, as ELRS 500 Hz), not every gyro loop
    {
        static uint64_t lsNextRcNs = 0;
        if (lsNowNs >= lsNextRcNs) {
            rxUpdateUdpChannels(rc.channels, SIMULATOR_MAX_RC_CHANNELS);
            lsNextRcNs += (uint64_t)OWFPV_LOCKSTEP_RC_US * 1000;
        }
    }
    if (!fdm_received) {
        printf("[SITL] lock-step: first fdm t:%f\\n", f.timestamp);
        fdm_received = true;
    }
    updateState(&f);
#ifdef OWFPV_LOCKSTEP_DEBUG
    {
        static uint32_t n = 0;
        if (++n % 4000 == 0) {
            printf("[LS] t=%.3f armed=%d rc=%.0f,%.0f,%.0f,%.0f motor=%.0f,%.0f,%.0f,%.0f gyro=%.1f,%.1f,%.1f looptime=%d\\n", f.timestamp,
                ARMING_FLAG(ARMED) ? 1 : 0, (double)rcData[0], (double)rcData[1], (double)rcData[2], (double)rcData[3],
                (double)motor[0], (double)motor[1], (double)motor[2], (double)motor[3],
                (double)gyro.gyroADCf[0], (double)gyro.gyroADCf[1], (double)gyro.gyroADCf[2], (int)gyro.targetLooptime);
            printf("[LS]   now=%u gyroTask=%u filterTask=%u pidTask=%u rxTask=%u\\n", (unsigned)micros(),
                (unsigned)getTask(TASK_GYRO)->lastExecutedAtUs, (unsigned)getTask(TASK_FILTER)->lastExecutedAtUs,
                (unsigned)getTask(TASK_PID)->lastExecutedAtUs, (unsigned)getTask(TASK_RX)->lastExecutedAtUs);
        }
    }
#endif
    lsStarted = true;
    lsLimitNs += (uint64_t)OWFPV_LOCKSTEP_US * 1000;
}
#endif
"""
open(p, "w").write(s)
print("patched", p)

# the real-time sleep per scheduler pass (RUN_LOOP_DELAY_US) would run once per virtual microsecond in lock-step
q = sys.argv[1] + "/src/platform/SIMULATOR/include/platform/platform.h"
t = open(q).read()
a = "#define RUN_LOOP_DELAY_US 50 // max 20khz run loop frequency"
assert t.count(a) == 1
t = t.replace(a, "#if !defined(OWFPV_LOCKSTEP) || !OWFPV_LOCKSTEP\n" + a + "\n#endif")
open(q, "w").write(t)
print("patched", q)
