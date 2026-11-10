/* 移植自 Folia components/visualizer/hanabi/timeline.ts — AGPL-3.0, chthollyphile/folia-major。仅类型剥离与 import 改写。 */
export const RISE_BEFORE = 0.6;
export const RISE_AFTER = 0.6;
export const LAUNCH_DURATION = 0.45;
export const ENTER_LEAD = 0.4;
const DRIFT_PER_SECOND = 0.03;
const DRIFT_MAX = 0.15;
const SWING_SHARPNESS = 4;
const PUNCH_ATTACK = 0.05;
const SPIN_CRUISE = 0.2;
const SPIN_CRUISE_TOTAL = 0.85;
const SPIN_SWING_MIN = 0.6;
const SPIN_SWING_RANGE = 0.8;
const SPIN_FLIP = 0.2;
const clamp = (value, min, max)=>Math.min(max, Math.max(min, value));
const smooth = (value)=>{
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};
export const easeSeptic = (value)=>{
    const t = clamp(value, 0, 1);
    return t ** 4 * (35 + t * (-84 + t * (70 - 20 * t)));
};
const easeSepticIntegral = (t)=>t ** 5 * (7 + t * (-14 + t * (10 - 2.5 * t)));
const binomial = (n, k)=>{
    let result = 1;
    for(let i = 1; i <= k; i += 1)result = result * (n - k + i) / i;
    return result;
};
const SWING_TERMS = Array.from({
    length: SWING_SHARPNESS + 1
}, (_, k)=>binomial(SWING_SHARPNESS, k) * (-1) ** k / (2 * k + 1));
const swingPrimitive = (u)=>{
    const u2 = u * u;
    let power = u;
    let sum = 0;
    for (const term of SWING_TERMS){
        sum += term * power;
        power *= u2;
    }
    return sum;
};
const SWING_HALF = swingPrimitive(1);
export const easeSwing = (value)=>0.5 + swingPrimitive(2 * clamp(value, 0, 1) - 1) / (2 * SWING_HALF);
export const planSpin = (durations, options)=>{
    const angles = [];
    const drift = [];
    let direction = options.direction;
    durations.forEach((duration, index)=>{
        if (index > 0) {
            const last = index === durations.length - 1;
            const roll = options.random();
            const reversed = direction !== options.direction;
            if (reversed ? last || roll < 0.5 : !last && roll < SPIN_FLIP) direction = -direction;
        }
        const cruise = direction * options.amount * Math.min(SPIN_CRUISE, SPIN_CRUISE_TOTAL / Math.max(duration, 0.5));
        drift.push(cruise);
        if (index === 0) {
            angles.push(0);
            return;
        }
        const swing = direction * options.amount * (SPIN_SWING_MIN + SPIN_SWING_RANGE * options.random());
        angles.push(angles[index - 1] + (drift[index - 1] * durations[index - 1] + cruise * duration) / 2 + swing);
    });
    return {
        angles,
        drift
    };
};
export const buildTimeline = (shots, options)=>{
    const { height, riseSpeed, motion } = options;
    const count = shots.length;
    const durationOf = (index)=>Math.max(shots[index].endTime - shots[index].startTime, 0.05);
    const before = shots.map((_, index)=>index === 0 ? 0 : Math.min(RISE_BEFORE, 0.45 * durationOf(index - 1)));
    const after = shots.map((_, index)=>index === 0 ? 0 : Math.min(RISE_AFTER, 0.35 * durationOf(index)));
    const timings = [];
    let worldY = 0;
    shots.forEach((shot, index)=>{
        if (index > 0) worldY -= clamp(shot.camera.rise, 0, 1.2) * riseSpeed * height;
        const boundary = shot.startTime;
        const sung = shot.firstSung ?? boundary;
        let enterAt = shot.isBridge ? boundary : Math.min(boundary, sung) - ENTER_LEAD;
        if (index > 0) enterAt = Math.max(enterAt, boundary - before[index], timings[index - 1].enterAt + 0.1);
        const duration = durationOf(index);
        timings.push({
            start: shot.startTime,
            end: shot.endTime,
            worldY,
            launchAt: enterAt - LAUNCH_DURATION,
            enterAt,
            exitAt: 0,
            exitDuration: 0,
            punchAt: enterAt + 0.08,
            riseIn: index === 0 ? null : {
                from: boundary - before[index],
                to: boundary + after[index]
            },
            drift: riseSpeed * height * Math.min(DRIFT_PER_SECOND, DRIFT_MAX / duration),
            spin: options.spinAngles?.[index] ?? 0,
            spinDrift: options.spinDrift?.[index] ?? 0
        });
    });
    timings.forEach((timing, index)=>{
        const shot = shots[index];
        const sungEnd = shot.lastSungEnd ?? timing.end;
        let exitAt;
        let exitDuration;
        if (index < count - 1) {
            const boundary = timing.end;
            exitAt = clamp(sungEnd, boundary - before[index + 1], boundary - 0.15);
            exitDuration = clamp(boundary + after[index + 1] - exitAt, 0.35, 0.9);
        } else if (options.exitStart != null) {
            exitAt = Math.min(Math.max(sungEnd, options.exitStart), options.unitEnd - 0.2);
            exitDuration = clamp(options.unitEnd - exitAt, 0.25, 0.7);
        } else {
            exitAt = options.unitEnd;
            exitDuration = 0.5;
        }
        timing.exitAt = Math.max(exitAt, timing.enterAt + 0.3);
        timing.exitDuration = exitDuration;
    });
    const shotAt = (time)=>{
        let found = 0;
        for(let index = 0; index < count; index += 1)if (timings[index].start <= time) found = index;
        return found;
    };
    const blended = (time, value)=>{
        for(let index = 1; index < count; index += 1){
            const window = timings[index].riseIn;
            if (time >= window.from && time <= window.to) {
                const k = easeSwing((time - window.from) / Math.max(window.to - window.from, 1e-3));
                return value(index - 1, time) + (value(index, time) - value(index - 1, time)) * k;
            }
        }
        return value(shotAt(time), time);
    };
    const target = (index, time)=>{
        const timing = timings[index];
        return -timing.worldY + timing.drift * (time - (timing.start + timing.end) / 2);
    };
    const rise = (time)=>count === 0 ? 0 : blended(time, target);
    const mids = timings.map((timing)=>(timing.start + timing.end) / 2);
    const spinSteps = timings.map((timing, index)=>{
        if (index === 0) return null;
        const previous = timings[index - 1];
        const window = timing.riseIn;
        const ramp = Math.max(window.to - window.from, 1e-3);
        const from = mids[index - 1];
        const drift = (time)=>{
            const x = (time - window.from) / ramp;
            const switched = x <= 0 ? 0 : x >= 1 ? ramp / 2 + (time - window.to) : ramp * easeSepticIntegral(x);
            return previous.spinDrift * (time - from) + (timing.spinDrift - previous.spinDrift) * switched;
        };
        const swing = timing.spin - previous.spin - drift(mids[index]);
        return (time)=>previous.spin + drift(time) + swing * easeSwing((time - window.from) / ramp);
    });
    const spin = (time)=>{
        if (count === 0) return 0;
        if (time <= mids[0]) return timings[0].spin + timings[0].spinDrift * (time - mids[0]);
        for(let index = 1; index < count; index += 1){
            if (time < mids[index]) return spinSteps[index](time);
        }
        const last = timings[count - 1];
        return last.spin + last.spinDrift * (time - mids[count - 1]);
    };
    const pushOf = (index, time)=>{
        const timing = timings[index];
        return 1 + shots[index].camera.push * smooth((time - timing.start) / Math.max(timing.end - timing.start, 0.05));
    };
    const rollOf = (index, time)=>{
        const timing = timings[index];
        return shots[index].camera.roll * motion * Math.sin((time - timing.start) * 0.9 + index * 1.3);
    };
    const camera = (time)=>{
        if (count === 0) return {
            scale: 1,
            rotation: 0,
            dx: 0,
            dy: 0
        };
        let scale = blended(time, pushOf);
        const rotation = blended(time, rollOf);
        let dx = 0;
        let dy = 0;
        for(let index = 0; index < count; index += 1){
            const age = time - timings[index].punchAt;
            const punch = shots[index].camera.punch;
            if (age < 0 || age > 0.9 || punch <= 0 || shots[index].isBridge) continue;
            const amp = punch * motion * Math.exp(-age / 0.16) * smooth(age / PUNCH_ATTACK);
            dx += amp * 0.012 * height * Math.sin(age * 70 + index);
            dy += amp * 0.016 * height * Math.cos(age * 55 + index * 2);
            scale *= 1 + amp * 0.03;
        }
        return {
            scale,
            rotation,
            dx,
            dy
        };
    };
    return {
        shots: timings,
        rise,
        spin,
        shotAt,
        camera
    };
};
