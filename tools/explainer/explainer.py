"""Manim animation for the study's explainer video. See build.sh.

Section lengths come from the narration audio, so picture and voice stay in sync.
"""
import json
import os

import numpy as np
from manim import (
    DOWN, LEFT, RIGHT, UP, BOLD, Circle, Create, DashedVMobject, Dot, Ellipse, FadeIn, FadeOut,
    GrowFromCenter, Line, Polygon, Rectangle, RoundedRectangle, Scene, Succession, Text, VGroup,
    VMobject, ValueTracker, always_redraw, config, linear,
)

PAPER = "#f3f1eb"
WHITE_CARD = "#ffffff"
INK = "#182321"
MUTED = "#5c6965"
LINE_GREY = "#a9b2a7"
LANE = "#e8ebe3"
TEAL = "#20786c"
GOOD = "#1f8a4c"
BAD = "#c93a2e"
SOURCES = ["#176875", "#974213", "#4d6926", "#754283"]
FONT = "Helvetica Neue"

config.background_color = PAPER


def text(value, size=34, color=INK, weight=None):
    if weight:
        return Text(value, font=FONT, font_size=size, color=color, weight=weight)
    return Text(value, font=FONT, font_size=size, color=color)


def heading(value):
    return text(value, 50, weight=BOLD).to_edge(UP, buff=0.55)


def mark(good, radius=0.3):
    disc = Circle(radius=radius, color=GOOD if good else BAD, fill_opacity=1, stroke_width=0)
    if good:
        glyph = VMobject(color=WHITE_CARD, stroke_width=7).set_points_as_corners(
            np.array([[-0.45, -0.02, 0], [-0.12, -0.36, 0], [0.48, 0.34, 0]]) * radius)
    else:
        size = 0.46 * radius
        glyph = VGroup(
            Line([-size, -size, 0], [size, size, 0], color=WHITE_CARD, stroke_width=7),
            Line([-size, size, 0], [size, -size, 0], color=WHITE_CARD, stroke_width=7))
    return VGroup(disc, glyph)


def waveform(x0, x1, y, amp, color, seed=1, envelope=None, noise=0.0, stroke=3.2):
    rng = np.random.default_rng(seed)
    count = max(int((x1 - x0) * 40), 8)
    xs = np.linspace(x0, x1, count)
    phase = np.linspace(0, 42 * (x1 - x0) / 3, count)
    body = 0.55 * np.sin(phase) + 0.45 * np.sin(phase * 2.3 + seed)
    slow = 0.55 + 0.45 * np.abs(np.sin(phase / 7 + seed))
    values = body * slow + noise * rng.normal(0, 1, count)
    if envelope is not None:
        values *= np.array([envelope((x - x0) / (x1 - x0)) for x in xs])
    points = np.c_[xs, y + amp * np.clip(values, -1, 1), np.zeros(count)]
    return VMobject(color=color, stroke_width=stroke).set_points_as_corners(points)


class Lanes(VGroup):
    """A timeline drawn with the same look as the study page."""

    def __init__(self, labels, width=9.0, label_width=2.5, row=0.74, gap=0.16, duration=10, top=1.45):
        super().__init__()
        self.duration = duration
        total = label_width + width
        self.x0 = -total / 2 + label_width
        self.span = width  # Not `self.width`: on a Mobject that is a property that rescales it.
        self.row = row
        self.tops = [top - i * (row + gap) for i in range(len(labels))]
        self.lanes, self.names = VGroup(), VGroup()
        for label, y in zip(labels, self.tops):
            name = text(label, 29, weight=BOLD)
            name.move_to([-total / 2 + name.width / 2, y - row / 2, 0])
            lane = Rectangle(width=width, height=row, color=LINE_GREY, stroke_width=2, fill_color=LANE, fill_opacity=1)
            lane.move_to([self.x0 + width / 2, y - row / 2, 0])
            self.names.add(name)
            self.lanes.add(lane)
        self.ticks = VGroup()
        for t in range(0, duration + 1, 2):
            tick = text(f"{t}s", 24, MUTED).move_to([self.x(t), top + 0.26, 0])
            self.ticks.add(tick)
        self.add(self.ticks, self.names, self.lanes)

    def x(self, t):
        return self.x0 + self.span * t / self.duration

    def center_y(self, row):
        return self.tops[row] - self.row / 2

    def block(self, row, start, end, color):
        inset = 0.07
        shape = Rectangle(width=self.x(end) - self.x(start), height=self.row - 2 * inset, color=color, fill_color=color, fill_opacity=1, stroke_width=0)
        return shape.move_to([(self.x(start) + self.x(end)) / 2, self.center_y(row), 0])

    def heard(self, row, start, end, color, seed=1, envelope=None, noise=0.0):
        return waveform(self.x(start), self.x(end), self.center_y(row), self.row * 0.4, color, seed, envelope, noise)

    def playhead(self, tracker):
        top = self.tops[0] + 0.08
        bottom = self.tops[-1] - self.row - 0.08
        return always_redraw(lambda: Line([self.x(tracker.get_value()), top, 0], [self.x(tracker.get_value()), bottom, 0], color=INK, stroke_width=5))


def video_card(letter, x, y, width=2.5):
    height = width * 9 / 16
    frame = RoundedRectangle(corner_radius=0.08, width=width, height=height, color=INK, fill_color="#22302d", fill_opacity=1, stroke_width=0)
    triangle = Polygon([-0.17, 0.2, 0], [-0.17, -0.2, 0], [0.24, 0, 0], color=WHITE_CARD, fill_color=WHITE_CARD, fill_opacity=1, stroke_width=0)
    name = text(f"Output {letter}", 28, weight=BOLD).next_to(frame, UP, buff=0.14)
    return VGroup(frame, triangle, name).move_to([x, y, 0])


def rank_badge(card, rank, color=TEAL):
    disc = Circle(radius=0.34, color=color, fill_color=color, fill_opacity=1, stroke_width=0)
    label = text(str(rank), 36, WHITE_CARD, BOLD).move_to(disc)
    return VGroup(disc, label).next_to(card[0], DOWN, buff=0.2)


class Explainer(Scene):
    def construct(self):
        with open(os.environ["EXPLAINER_DURATIONS"]) as handle:
            self.lengths = json.load(handle)
        for name in ["intro", "timeline", "timing", "hearing", "quality", "natural", "overall"]:
            self.total = self.lengths[name]
            self.elapsed = 0.0
            getattr(self, f"section_{name}")()
            self.to(self.total - 0.35)
            visible = [m for m in self.mobjects if isinstance(m, VMobject)]
            self.go(FadeOut(VGroup(*visible)), run_time=0.35)
            self.clear()

    def go(self, *animations, run_time=0.6, **kwargs):
        self.play(*animations, run_time=run_time, **kwargs)
        self.elapsed += run_time

    def to(self, seconds):
        if seconds > self.elapsed + 0.02:
            self.wait(seconds - self.elapsed)
            self.elapsed = seconds

    def frac(self, value):
        self.to(self.total * value)

    def section_intro(self):
        title = text("Rank 4 videos of the same scene", 50, weight=BOLD).shift(UP * 2.55)
        self.go(FadeIn(title, shift=UP * 0.2), run_time=0.7)
        spacing, cards = 3.1, []
        for i, letter in enumerate("ABCD"):
            cards.append(video_card(letter, (i - 1.5) * spacing, 0.35))
        self.go(*[FadeIn(card, shift=UP * 0.2) for card in cards], run_time=0.8)
        self.frac(0.42)
        order = [1, 3, 0, 2]
        badges = [rank_badge(cards[index], rank + 1) for rank, index in enumerate(order)]
        for badge in badges:
            self.go(GrowFromCenter(badge), run_time=0.32)
        self.frac(0.78)
        caption = text("Here is what to look and listen for", 38, MUTED).to_edge(DOWN, buff=0.75)
        self.go(FadeIn(caption), run_time=0.5)

    def section_timeline(self):
        title = heading("The sound timeline")
        rows = [("Door sound", SOURCES[0], [(0.5, 2.5)]), ("Voice", SOURCES[1], [(3, 6)]), ("Guitar", SOURCES[2], [(0, 10)])]
        lanes = Lanes([r[0] for r in rows], top=1.3)
        self.go(FadeIn(title), run_time=0.5)
        self.go(FadeIn(lanes), run_time=0.6)
        self.frac(0.25)
        blocks = [lanes.block(i, s, e, color) for i, (_, color, spans) in enumerate(rows) for s, e in spans]
        caption = text("Blocks show when each sound should be heard", 36, MUTED).to_edge(DOWN, buff=0.7)
        self.go(*[GrowFromCenter(b) for b in blocks], FadeIn(caption), run_time=0.8)
        self.frac(0.62)
        tracker = ValueTracker(0)
        head = lanes.playhead(tracker)
        self.add(head)
        sweep = self.total * 0.95 - self.elapsed
        self.go(tracker.animate.set_value(10), run_time=sweep, rate_func=linear)
        self.remove(head)
        self.add(lanes.playhead(tracker))

    def section_timing(self):
        title = heading("1. Timing")
        lanes = Lanes(["Requested", "On time", "Too early", "Too late"], top=1.75, label_width=2.6)
        self.go(FadeIn(title), FadeIn(lanes), run_time=0.6)
        target = lanes.block(0, 4, 7, SOURCES[1])
        window = VGroup(
            DashedVMobject(Line([lanes.x(4), lanes.tops[0], 0], [lanes.x(4), lanes.tops[3] - lanes.row, 0], color=SOURCES[1], stroke_width=3), num_dashes=22),
            DashedVMobject(Line([lanes.x(7), lanes.tops[0], 0], [lanes.x(7), lanes.tops[3] - lanes.row, 0], color=SOURCES[1], stroke_width=3), num_dashes=22))
        self.go(GrowFromCenter(target), FadeIn(window), run_time=0.7)
        self.frac(0.26)
        for row, (start, end, good, at) in enumerate([(4.1, 6.9, True, 0.26), (1.4, 4.2, False, 0.52), (6.8, 9.6, False, 0.72)], start=1):
            self.frac(at)
            wave = lanes.heard(row, start, end, SOURCES[1], seed=row + 2)
            icon = mark(good).move_to([lanes.x(10) + 0.55, lanes.center_y(row), 0])
            self.go(Create(wave), run_time=0.75)
            self.go(GrowFromCenter(icon), run_time=0.25)

    def section_hearing(self):
        title = heading("2. Can you hear every requested sound?")
        self.go(FadeIn(title), run_time=0.5)
        lanes = Lanes(["Dog bark", "Heard", "Voice", "Heard"], top=1.6, row=0.66)
        self.go(FadeIn(lanes), run_time=0.5)
        self.go(GrowFromCenter(lanes.block(0, 0.5, 3, SOURCES[0])), GrowFromCenter(lanes.block(2, 4, 8, SOURCES[1])), run_time=0.5)
        flat = Line([lanes.x(0.5), lanes.center_y(1), 0], [lanes.x(3), lanes.center_y(1), 0], color=MUTED, stroke_width=3)
        missing = text("Missing", 30, BAD, BOLD).move_to([lanes.x(5.5), lanes.center_y(1), 0])
        self.go(Create(flat), Create(lanes.heard(3, 4.1, 7.9, SOURCES[1], seed=5)), run_time=0.8)
        self.frac(0.2)
        icon = mark(False).move_to([lanes.x(10) + 0.55, lanes.center_y(1), 0])
        self.go(FadeIn(missing), GrowFromCenter(icon), run_time=0.4)
        self.frac(0.3)
        self.go(*[FadeOut(m) for m in self.mobjects if m is not title], run_time=0.4)
        subtitle = text("Piano and violin requested for the whole clip", 36, MUTED).next_to(title, DOWN, buff=0.28)
        self.go(FadeIn(subtitle), run_time=0.4)
        both = Lanes(["Piano", "Violin"], top=1.0, row=0.62, gap=0.1)
        turns = Lanes(["Piano", "Violin"], top=-0.95, row=0.62, gap=0.1)
        for lane_group in (both, turns):
            lane_group.remove(lane_group.ticks)
        good_label = text("Both together", 32, GOOD, BOLD).next_to(both.lanes[0], UP, buff=0.14).align_to(both.lanes[0], LEFT)
        bad_label = text("Taking turns", 32, BAD, BOLD).next_to(turns.lanes[0], UP, buff=0.14).align_to(turns.lanes[0], LEFT)
        self.frac(0.45)
        self.go(FadeIn(both), FadeIn(good_label), run_time=0.4)
        self.go(Create(both.heard(0, 0, 10, SOURCES[2], seed=2)), Create(both.heard(1, 0, 10, SOURCES[3], seed=7)), GrowFromCenter(mark(True).move_to([both.x(10) + 0.55, both.tops[0] - 0.36, 0])), run_time=1.3)
        self.frac(0.68)
        self.go(FadeIn(turns), FadeIn(bad_label), run_time=0.4)
        on_piano = lambda f: 1.0 if int(f * 4) % 2 == 0 else 0.04
        on_violin = lambda f: 0.04 if int(f * 4) % 2 == 0 else 1.0
        self.go(Create(turns.heard(0, 0, 10, SOURCES[2], seed=2, envelope=on_piano)), Create(turns.heard(1, 0, 10, SOURCES[3], seed=7, envelope=on_violin)), GrowFromCenter(mark(False).move_to([turns.x(10) + 0.55, turns.tops[0] - 0.36, 0])), run_time=1.4)

    def section_quality(self):
        title = heading("3. Audio quality")
        self.go(FadeIn(title), run_time=0.5)
        panels = VGroup()
        for x, name, color, good, noise, words in [(-3.3, "Clean and clear", GOOD, True, 0.0, "Easy to understand"), (3.3, "Noisy or distorted", BAD, False, 0.55, "Hiss · robotic · muffled")]:
            card = RoundedRectangle(corner_radius=0.12, width=6.0, height=3.5, color=LINE_GREY, fill_color=WHITE_CARD, fill_opacity=1, stroke_width=2).move_to([x, -0.35, 0])
            label = text(name, 36, weight=BOLD).move_to([x, 0.95, 0])
            wave = waveform(x - 2.5, x + 2.5, -0.4, 0.72, SOURCES[0], seed=3, noise=noise, stroke=4)
            caption = text(words, 28, MUTED).move_to([x, -1.65, 0])
            icon = mark(good, 0.27).move_to([x + 2.5, 1.0, 0])
            panels.add(VGroup(card, label, wave, caption, icon))
        self.frac(0.12)
        self.go(FadeIn(panels[0], shift=UP * 0.15), run_time=0.6)
        self.frac(0.42)
        self.go(FadeIn(panels[1], shift=UP * 0.15), run_time=0.6)

    def section_natural(self):
        title = heading("4. Naturalness")
        self.go(FadeIn(title), run_time=0.5)
        x_positions = [-4.3, 0, 4.3]
        titles = ["Fits what you see", "Lips match the words", "Same room"]
        cards = VGroup()
        for x, name in zip(x_positions, titles):
            card = RoundedRectangle(corner_radius=0.12, width=3.9, height=3.6, color=LINE_GREY, fill_color=WHITE_CARD, fill_opacity=1, stroke_width=2).move_to([x, -0.35, 0])
            label = text(name, 26, weight=BOLD).move_to([x, -1.65, 0])
            cards.add(VGroup(card, label))

        scene_frame = RoundedRectangle(corner_radius=0.06, width=2.3, height=1.3, color=INK, fill_color="#22302d", fill_opacity=1, stroke_width=0).move_to([x_positions[0], 0.2, 0])
        link = waveform(x_positions[0] - 0.95, x_positions[0] + 0.95, 0.2, 0.34, "#e8ebe3", seed=4, stroke=3)
        face = Circle(radius=0.8, color=INK, fill_color="#efd9c2", fill_opacity=1, stroke_width=3).move_to([x_positions[1], 0.25, 0])
        eyes = VGroup(*[Dot([x_positions[1] + dx, 0.5, 0], radius=0.075, color=INK) for dx in (-0.28, 0.28)])
        mouth = Ellipse(width=0.58, height=0.14, color=INK, fill_color=INK, fill_opacity=1).move_to([x_positions[1], -0.13, 0])
        room = Polygon([x_positions[2] - 1.1, -0.65, 0], [x_positions[2] + 1.1, -0.65, 0], [x_positions[2] + 1.1, 0.65, 0], [x_positions[2], 1.1, 0], [x_positions[2] - 1.1, 0.65, 0], color=INK, stroke_width=3, fill_color=LANE, fill_opacity=1)
        people = VGroup(*[Circle(radius=0.22, color=col, fill_color=col, fill_opacity=1, stroke_width=0).move_to([x_positions[2] + dx, -0.14, 0]) for dx, col in ((-0.46, SOURCES[0]), (0.46, SOURCES[1]))])
        bodies = VGroup(*[Rectangle(width=0.42, height=0.32, color=col, fill_color=col, fill_opacity=1, stroke_width=0).move_to([x_positions[2] + dx, -0.47, 0]) for dx, col in ((-0.46, SOURCES[0]), (0.46, SOURCES[1]))])

        self.frac(0.16)
        self.go(FadeIn(cards[0]), FadeIn(scene_frame), Create(link), run_time=0.7)
        self.frac(0.4)
        self.go(FadeIn(cards[1]), FadeIn(face), FadeIn(eyes), FadeIn(mouth), run_time=0.6)
        speak = [mouth.animate.stretch_to_fit_height(h) for h in (0.42, 0.12, 0.34, 0.12)]
        self.go(Succession(*speak, run_time=1.1), run_time=1.1)
        self.frac(0.68)
        self.go(FadeIn(cards[2]), FadeIn(room), FadeIn(people), FadeIn(bodies), run_time=0.7)

    def section_overall(self):
        title = heading("Then: which do you prefer overall?")
        self.go(FadeIn(title), run_time=0.5)
        chips = VGroup()
        for i, name in enumerate(["Timing", "All sounds", "Audio quality", "Naturalness"]):
            pill = RoundedRectangle(corner_radius=0.32, width=2.9, height=0.74, color=TEAL, fill_color=TEAL, fill_opacity=1, stroke_width=0)
            chips.add(VGroup(pill, text(name, 29, WHITE_CARD, BOLD).move_to(pill)).move_to([(i - 1.5) * 3.15, 1.55, 0]))
        self.go(*[FadeIn(c, shift=DOWN * 0.1) for c in chips], run_time=0.7)
        cards = [video_card(letter, (i - 1.5) * 3.15, -0.45, width=2.45) for i, letter in enumerate("ABCD")]
        self.frac(0.26)
        self.go(*[FadeIn(card) for card in cards], run_time=0.6)
        self.frac(0.36)
        for rank, index in enumerate([2, 0, 3]):
            badge = rank_badge(cards[index], rank + 1)
            tap = Circle(radius=0.5, color=TEAL, stroke_width=5).move_to(badge)
            self.go(GrowFromCenter(badge), FadeIn(tap), run_time=0.3)
            self.go(FadeOut(tap, scale=1.5), run_time=0.25)
        self.frac(0.56)
        last = rank_badge(cards[1], 4, MUTED)
        note = text("Fills in by itself", 25, MUTED).next_to(last, DOWN, buff=0.1)
        self.go(GrowFromCenter(last), FadeIn(note), run_time=0.5)
        self.frac(0.84)
        thanks = text("Use headphones if you can. Thank you!", 38, weight=BOLD).to_edge(DOWN, buff=0.45)
        self.go(FadeIn(thanks), run_time=0.5)
