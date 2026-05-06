import type { Composition } from "../../src/schema/types.js";

// Minimal valid composition derived from design-doc §3.1.
export function baseComposition(): Composition {
  return {
    version: "0.1",
    composition: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 25,
      background: "#000000",
    },
    assets: [
      { id: "logo", type: "image", src: "./assets/logo.png" },
      { id: "bg", type: "image", src: "./assets/bg.jpg" },
      {
        id: "inter",
        type: "font",
        src: "./fonts/Inter-Bold.ttf",
        family: "Inter",
      },
    ],
    layers: [
      {
        id: "background-layer",
        z: 0,
        opacity: 1,
        blendMode: "normal",
        items: ["bg-sprite"],
      },
      {
        id: "foreground-layer",
        z: 10,
        opacity: 1,
        blendMode: "normal",
        items: ["logo-sprite", "title-text"],
      },
    ],
    items: {
      "bg-sprite": {
        type: "sprite",
        asset: "bg",
        width: 1920,
        height: 1080,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      "logo-sprite": {
        type: "sprite",
        asset: "logo",
        width: 400,
        height: 400,
        transform: {
          x: 960,
          y: 540,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      "title-text": {
        type: "text",
        text: "Hello, World",
        font: "inter",
        fontSize: 96,
        color: "#ffffff",
        transform: {
          x: 960,
          y: 800,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
    },
    tweens: [
      {
        id: "logo-fade-in",
        target: "logo-sprite",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0,
        duration: 1,
        easing: "easeOutQuad",
      },
    ],
  };
}
