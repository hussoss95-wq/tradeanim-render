# Easing functions.

import math


def linear(t: float) -> float:
    return t


def ease_in_quad(t: float) -> float:
    return t * t


def ease_out_quad(t: float) -> float:
    return t * (2 - t)


def ease_in_out_quad(t: float) -> float:
    if t < 0.5:
        return 2 * t * t
    return -1 + (4 - 2 * t) * t


def ease_in_cubic(t: float) -> float:
    return t * t * t


def ease_out_cubic(t: float) -> float:
    t -= 1
    return t * t * t + 1


def ease_in_out_cubic(t: float) -> float:
    if t < 0.5:
        return 4 * t * t * t
    t -= 1
    return 1 + 4 * t * t * t


def ease_in_sine(t: float) -> float:
    return 1 - math.cos(t * math.pi / 2)


def ease_out_sine(t: float) -> float:
    return math.sin(t * math.pi / 2)


def ease_in_out_sine(t: float) -> float:
    return 0.5 * (1 - math.cos(math.pi * t))


def ease_in_expo(t: float) -> float:
    return 0.0 if t == 0 else 2 ** (10 * (t - 1))


def ease_out_expo(t: float) -> float:
    return 1.0 if t == 1 else 1 - 2 ** (-10 * t)


def ease_in_out_expo(t: float) -> float:
    if t == 0:
        return 0.0
    if t == 1:
        return 1.0
    if t < 0.5:
        return 0.5 * 2 ** (20 * t - 10)
    return 1 - 0.5 * 2 ** (-20 * t + 10)


def ease_out_back(t: float) -> float:
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def ease_out_elastic(t: float) -> float:
    if t == 0:
        return 0.0
    if t == 1:
        return 1.0
    p = 0.3
    return 2 ** (-10 * t) * math.sin((t - p / 4) * (2 * math.pi) / p) + 1


def ease_out_bounce(t: float) -> float:
    n1 = 7.5625
    d1 = 2.75
    if t < 1 / d1:
        return n1 * t * t
    elif t < 2 / d1:
        t -= 1.5 / d1
        return n1 * t * t + 0.75
    elif t < 2.5 / d1:
        t -= 2.25 / d1
        return n1 * t * t + 0.9375
    else:
        t -= 2.625 / d1
        return n1 * t * t + 0.984375
