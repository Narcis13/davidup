// Browser preview demo — plays the §3.1 hello-world animation through
// attach(comp, canvas). The composition mirrors design-doc §3.1: a logo
// fades in (opacity 0→1 over 1.0s, easeOutQuad) while popping in scale
// (0.5→1.0 over 1.5s, easeOutBack on both axes). The logo is a shape
// stand-in so the demo runs with zero external assets.

import { attach, type AttachHandle } from "../../src/drivers/browser/index.js";
import type { Composition } from "../../src/schema/types.js";

const comp: Composition = {
  version: "0.1",
  composition: {
    width: 1280,
    height: 720,
    fps: 60,
    duration: 3.0,
    background: "#0a0e27",
  },
  assets: [],
  layers: [
    {
      id: "foreground",
      z: 10,
      opacity: 1,
      blendMode: "normal",
      items: ["logo"],
    },
  ],
  items: {
    logo: {
      type: "shape",
      kind: "rect",
      width: 320,
      height: 320,
      cornerRadius: 48,
      fillColor: "#ff6b35",
      transform: {
        x: 640,
        y: 360,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 0,
      },
    },
  },
  tweens: [
    {
      id: "logo-fade-in",
      target: "logo",
      property: "transform.opacity",
      from: 0,
      to: 1,
      start: 0,
      duration: 1.0,
      easing: "easeOutQuad",
    },
    {
      id: "logo-pop-x",
      target: "logo",
      property: "transform.scaleX",
      from: 0.5,
      to: 1.0,
      start: 0,
      duration: 1.5,
      easing: "easeOutBack",
    },
    {
      id: "logo-pop-y",
      target: "logo",
      property: "transform.scaleY",
      from: 0.5,
      to: 1.0,
      start: 0,
      duration: 1.5,
      easing: "easeOutBack",
    },
  ],
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const replayBtn = document.getElementById("replay") as HTMLButtonElement;
const seek0Btn = document.getElementById("seek0") as HTMLButtonElement;
const seek1Btn = document.getElementById("seek1") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;

let handle: AttachHandle | null = null;

async function start(): Promise<void> {
  handle?.stop();
  status.textContent = "playing";
  handle = await attach(comp, canvas);
  setTimeout(() => {
    if (handle) status.textContent = "ended";
  }, comp.composition.duration * 1000 + 50);
}

replayBtn.addEventListener("click", () => {
  void start();
});
seek0Btn.addEventListener("click", () => handle?.seek(0));
seek1Btn.addEventListener("click", () => handle?.seek(1));
stopBtn.addEventListener("click", () => {
  handle?.stop();
  handle = null;
  status.textContent = "stopped";
});

void start();
