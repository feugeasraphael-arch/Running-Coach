# Zones, Paces and Pacing — Calculation Reference

> Calculation file. Every intensity the coach prescribes is derived from here.
> No pace and no heart rate may be stated without coming from a formula in this file.
>
> Terminology: **MAS** = Maximal Aerobic Speed = vVO2max (French: *VMA*). When answering
> in French, use the athlete's own vocabulary (VMA, EF, allure, fractionné).

---

## 1. Required Inputs

| Variable | Symbol | Source | If missing |
|---|---|---|---|
| Maximal Aerobic Speed | `MAS` (km/h) | Field test | Estimate from a PR (§2.2) — **and say so** |
| Maximum heart rate | `HRmax` (bpm) | **Measured** in the field | Estimate (§2.3) — **and flag ± 10-12 bpm** |
| Resting heart rate | `HRrest` (bpm) | On waking, lying down, 3-day mean | Zones as % HRmax only |
| Weekly volume | `Vol` (km/wk) | Last 4 weeks of history | Blocking: ask |

---

## 2. Measurement and Estimation

### 2.1 MAS Field Tests (most to least reliable)

| Test | Protocol | Formula |
|---|---|---|
| **VAMEVAL / Léger** | +0.5 km/h per minute, 20 m markers | `MAS` = speed of last completed stage |
| **Half-Cooper** | 6 min all-out, flat | `MAS (km/h) = distance (m) / 100` |
| **Cooper** | 12 min all-out | `MAS (km/h) = distance (m) / 200` |
| **5 min test** | 5 min all-out | `MAS (km/h) ≈ distance (m) / 100 × 0.97` |

> Retest every **8 to 12 weeks**. A MAS older than 4 months is a stale MAS.

### 2.2 Estimating MAS from a Personal Record

```
% of MAS sustained by distance (trained runner):
   3 000 m  →  95-98 %
   5 000 m  →  92-95 %
  10 000 m  →  85-92 %
  half      →  80-85 %
```

`Estimated MAS = PR velocity / coefficient`

> ⚠️ For a low-volume runner (< 30 km/wk), use the **lower bound** of each coefficient: their endurance index is weak, so they fall off MAS faster.

### 2.3 Estimating HRmax — Last Resort

| Formula | Expression | Typical error |
|---|---|---|
| Tanaka (2001) — **preferred** | `208 − 0.7 × age` | ± 10 bpm |
| Classic | `220 − age` | ± 12 bpm, biased after 40 |

**Preferred field measurement:** after a 20 min warm-up, 3 × 3 min uphill building to all-out on the last minute. Highest HR observed = working HRmax.
> In practice, the peak reached at the end of the last rep of a 4 × 4 min session is an excellent approximation.

### 2.4 Heart Rate Reserve (Karvonen)

```
HRreserve  = HRmax − HRrest
Target HR  = HRrest + (%intensity × HRreserve)
```
> **Karvonen is more accurate than % HRmax** in Z1-Z2, where % HRmax overstates the true intensity. Use it whenever `HRrest` is known.

---

## 3. The Five Zones

| Zone | Name | % HRmax | % HRreserve | % MAS | Lactate | RPE /10 | Sustainable for |
|:--:|---|:--:|:--:|:--:|:--:|:--:|---|
| **Z1** | Recovery | 60-70 % | 50-60 % | 50-60 % | < 1.5 | 2-3 | Unlimited |
| **Z2** | Easy / aerobic base | 70-80 % | 60-72 % | 60-70 % | 1.5-2 | 3-4 | 1-3 h |
| **Z3** | Tempo / marathon pace | 80-87 % | 72-82 % | 70-80 % | 2-3 | 5-6 | 45-90 min |
| **Z4** | Threshold / vRCP / **10K pace** | 87-92 % | 82-90 % | 80-90 % | 3-5 | 7-8 | 20-60 min |
| **Z5** | VO2max | 92-100 % | 90-100 % | 90-105 % | > 5 | 9-10 | 4-12 min total |

### 3.1 Mapping to the Polarised Model (Seiler)

```
POL-1  (target 80 %)  =  Z1 + Z2              ← below VT1
POL-2  (target 0-5 %) =  Z3 + low Z4          ← "grey zone": programme it, never drift into it
POL-3  (target 20 %)  =  high Z4 + Z5         ← above VT2 / RCP
```

### 3.2 Talk Test (field check, no watch)

| Zone | What you can say |
|---|---|
| Z1-Z2 | Full sentences; nasal breathing possible |
| Z3 | Short sentences; deep, rhythmic breathing |
| Z4 | 3-4 words maximum; breathing locked to stride |
| Z5 | One word, or nothing |

---

## 4. Target 10K Pace

### 4.1 MAS Coefficient by Profile

`v10 (km/h) = MAS × k`

| Profile | Weekly volume | Experience | **k** |
|---|---|---|:--:|
| Low base | < 25 km/wk | < 1 year, or returning | **0.80 - 0.84** |
| Intermediate | 25-45 km/wk | 1-3 consistent years | **0.85 - 0.88** |
| Trained | 45-70 km/wk | > 3 years, several cycles | **0.88 - 0.91** |
| Elite | > 80 km/wk | — | **0.92 - 0.94** |

> `k` is the **endurance index**. It is built by **easy volume**, not by intervals.
> A runner with a good MAS and a low `k` needs more Z2 volume, not more VO2max sessions.

### 4.2 Conversions

```
v10 (km/h)          = MAS × k
Pace (min/km)       = 60 / v10
10K time (min)      = 600 / v10
Seconds per km      = 3600 / v10

Inverse:
v10 (km/h)          = 600 / 10K_time_in_minutes
```

**Worked example** — MAS = 14.5 km/h, intermediate profile, k = 0.845:
```
v10   = 14.5 × 0.845  = 12.25 km/h
pace  = 60 / 12.25    = 4.898 min/km  → 4:54 /km
time  = 600 / 12.25   = 48.98 min     → 49:00
```

### 4.3 Consistency Check Against vRCP — Mandatory

```
Estimated vRCP ≈ MAS × 0.86   (range 0.82 - 0.90)
Check          : v10 must fall between 0.95 × vRCP and 1.00 × vRCP
```
> If `v10 > vRCP`, **the goal is unrealistic**. Refuse the plan; recalibrate the target or push the date.

### 4.4 Training Paces Derived from 10K Pace

| Session | Pace | Zone |
|---|---|---|
| Recovery | 10K pace **+ 90 to 120 s/km** | Z1 |
| Easy run | 10K pace **+ 60 to 90 s/km** | Z2 |
| Long run | 10K pace **+ 55 to 80 s/km** | Z2 |
| Marathon / tempo | 10K pace **+ 25 to 35 s/km** | Z3 |
| Threshold (20-30 min continuous) | 10K pace **+ 10 to 15 s/km** | low Z4 |
| **10K specific** | **10K pace** | high Z4 |
| 5K pace | 10K pace **− 12 to 18 s/km** | low Z5 |
| VO2max (3-5 min reps) | 10K pace **− 20 to 30 s/km** ≈ 95-100 % MAS | Z5 |
| 30-30 | **100 % MAS** | Z5 |
| Strides | ≈ 1500 m pace, relaxed | Neuromuscular |

---

## 5. Split Times and Race Execution

### 5.1 Building the Splits

Let `T` be the target time in seconds and `t = T / 10` the mean kilometre.

**Recommended profile (slight negative split):**

```
km 1      : t + 5 s
km 2      : t + 3 s
km 3 to 8 : t              (6 km)
km 9      : t − 4 s
km 10     : t − 4 s
```
**Mandatory checksum:** `(t+5) + (t+3) + 6t + (t−4) + (t−4) = 10t + 0` ✔
> Always verify the splits sum to exactly the target time before stating them.

**Example — target 49:00 (T = 2940 s, t = 294 s = 4:54):**

| km | Split | Elapsed |
|:--:|:--:|:--:|
| 1 | 4:59 | 4:59 |
| 2 | 4:57 | 9:56 |
| 3 | 4:54 | 14:50 |
| 4 | 4:54 | 19:44 |
| 5 | 4:54 | 24:38 |
| 6 | 4:54 | 29:32 |
| 7 | 4:54 | 34:26 |
| 8 | 4:54 | 39:20 |
| 9 | 4:50 | 44:10 |
| 10 | 4:50 | **49:00** |

### 5.2 Pacing Rules

- Pace variation **< 2 %** around the mean.
- **Never more than +2 % velocity** over the first 2 km, however easy it feels — that feeling is precisely the symptom.
- **HR is useless over the first 3 km**: 2-3 min of cardiac inertia. Run to pace.
- The last kilometre is run on feel, not on the watch.

---

## 6. Cardiac Drift

### 6.1 Definition and Measurement

**Cardiac drift** = progressive HR rise at constant pace.

**Pace:HR decoupling** — on a steady-state run, split it in half:

```
ratio₁ = pace_first_half / HR_first_half
ratio₂ = pace_second_half / HR_second_half

Decoupling (%) = (ratio₁ − ratio₂) / ratio₁ × 100
```

| Decoupling | Interpretation |
|---|---|
| **< 5 %** | Solid aerobic base, session well calibrated ✔ |
| 5 - 10 % | Insufficient base **or** pace too high for the intended zone |
| **> 10 %** | Pace clearly too high, heat, dehydration, or background fatigue |

**Physiology:** dehydration ↓ plasma volume → ↓ stroke volume → ↑ compensatory HR at constant cardiac output; hyperthermia (blood diverted to skin); glycogen depletion.

### 6.2 What to Steer By

| Context | Steer by | Role of HR |
|---|---|---|
| Z1-Z2, run < 60 min | **HR** | Primary reference |
| Z1-Z2, run > 75 min | **Starting pace** | Tolerate +5 % drift; neither speed up nor slow down |
| Z3-Z4 | **Pace** | Monitoring only |
| Z5, reps < 3 min | **Pace / feel** | Useless as an average → read **end-of-rep HR** |

- **Cardiac inertia:** 60 to 120 s to plateau. On short reps the mean HR systematically **understates** the true intensity.
- In a 4 × 4 min session, the target HR band (90-95 % HRmax) should be reached **at the end of each rep**, not in the first minute.

### 6.3 Environmental Corrections

```
Heat      : roughly +1 bpm per °C above 20 °C
            pace: +2 to +4 s/km per 5 °C above 15 °C
Humidity  : > 70 % RH → add half the heat correction
Altitude  : > 1000 m → HR +5 to +10 bpm at a given pace
Wind      : headwind costs ≈ +3 to +6 s/km; NEVER compensate by chasing HR
Hills     : steer by effort/HR uphill, by pace on the flat
```
> **Absolute rule:** in real heat, keep the **target HR** and abandon the **target pace**. The other way round produces heat illness, not adaptation.

### 6.4 Red Flags

- **Resting HR +7 bpm** on two consecutive mornings → easy day or rest.
- **HR +8 to 10 bpm** above normal at a known easy pace → cancel the quality session.
- **Unable to reach target HR** in Z5 with heavy legs → central fatigue; stop the session.
