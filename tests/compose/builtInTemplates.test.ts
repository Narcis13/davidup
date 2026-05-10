// Smoke tests for the v0.3 built-in templates registered globally on
// import. Each template gets a happy-path expansion + a check that its
// declared params reach the produced items / tweens. Template-mechanic
// edge cases (id rewriting, time mapping, validation errors) are covered
// in templates.test.ts; this file only verifies that the *content* of
// each built-in is correct and that registration happens as a
// side-effect of importing the public compose module.

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_TEMPLATE_IDS,
  expandTemplate,
  getTemplateDefinition,
  hasTemplate,
} from "../../src/compose/index.js";
import { precompile } from "../../src/compose/precompile.js";

describe("built-in templates — registration", () => {
  it("registers all five built-ins on the global registry", () => {
    for (const id of BUILT_IN_TEMPLATE_IDS) {
      expect(hasTemplate(id), `expected built-in "${id}" to be registered`).toBe(true);
      expect(getTemplateDefinition(id)?.id).toBe(id);
    }
  });

  it("exposes BUILT_IN_TEMPLATE_IDS as the canonical roster", () => {
    expect([...BUILT_IN_TEMPLATE_IDS].sort()).toEqual([
      "bulletList",
      "captionBurst",
      "kenburnsImage",
      "lowerThird",
      "titleCard",
    ]);
  });
});

describe("titleCard", () => {
  it("emits title + subtitle items with substituted text/font/colors", () => {
    const ex = expandTemplate("intro", {
      template: "titleCard",
      params: {
        title: "Davidup",
        subtitle: "Comprehensive Feature Demo",
        fontDisplay: "font-display",
        fontMono: "font-mono",
      },
    });

    expect(Object.keys(ex.items).sort()).toEqual(["intro__subtitle", "intro__title"]);
    expect((ex.items["intro__title"] as any).text).toBe("Davidup");
    expect((ex.items["intro__title"] as any).font).toBe("font-display");
    expect((ex.items["intro__title"] as any).fontSize).toBe(96);
    expect((ex.items["intro__title"] as any).color).toBe("#ffffff");
    expect((ex.items["intro__subtitle"] as any).text).toBe("Comprehensive Feature Demo");
    expect((ex.items["intro__subtitle"] as any).font).toBe("font-mono");
    expect((ex.items["intro__subtitle"] as any).color).toBe("#ffd166");
  });

  it("propagates start offset and emits popIn + fadeIn behaviors", () => {
    const ex = expandTemplate(
      "intro",
      {
        template: "titleCard",
        start: 2,
        params: {
          title: "T",
          fontDisplay: "fd",
          fontMono: "fm",
        },
      },
    );
    const popIn = ex.tweens.find(
      (t) => (t as any).$behavior === "popIn",
    ) as Record<string, unknown>;
    const fadeIn = ex.tweens.find(
      (t) => (t as any).$behavior === "fadeIn",
    ) as Record<string, unknown>;
    expect(popIn?.target).toBe("intro__title");
    expect(popIn?.start).toBe(2);
    expect(fadeIn?.target).toBe("intro__subtitle");
    expect(fadeIn?.start).toBeCloseTo(2.4, 10);
  });

  it("compiles end-to-end through precompile (templates → behaviors)", async () => {
    const comp = {
      version: "0.3",
      composition: { width: 1280, height: 720, fps: 30, duration: 5, background: "#000" },
      assets: [],
      layers: [
        { id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["intro"] },
      ],
      items: {
        intro: {
          $template: "titleCard",
          params: {
            title: "Hello",
            subtitle: "World",
            fontDisplay: "fd",
            fontMono: "fm",
          },
        },
      },
      tweens: [],
    };
    const out = (await precompile(comp)) as {
      items: Record<string, unknown>;
      tweens: Array<Record<string, unknown>>;
    };
    // popIn produces opacity + scaleX + scaleY = 3 tweens.
    // fadeIn produces 1 opacity tween.
    expect(out.tweens).toHaveLength(4);
    const titleProps = out.tweens
      .filter((t) => t.target === "intro__title")
      .map((t) => t.property)
      .sort();
    expect(titleProps).toEqual([
      "transform.opacity",
      "transform.scaleX",
      "transform.scaleY",
    ]);
    const subtitleProps = out.tweens
      .filter((t) => t.target === "intro__subtitle")
      .map((t) => t.property);
    expect(subtitleProps).toEqual(["transform.opacity"]);
  });
});

describe("lowerThird", () => {
  it("emits bar + name + role with substituted params and entry tweens", () => {
    const ex = expandTemplate(
      "lt",
      {
        template: "lowerThird",
        params: {
          name: "Narcis",
          role: "Engineer",
          fontDisplay: "fd",
          fontMono: "fm",
        },
      },
    );
    expect(Object.keys(ex.items).sort()).toEqual([
      "lt__bar",
      "lt__name",
      "lt__role",
    ]);
    expect((ex.items["lt__name"] as any).text).toBe("Narcis");
    expect((ex.items["lt__role"] as any).text).toBe("Engineer");
    expect((ex.items["lt__bar"] as any).fillColor).toBe("#ffd166");

    const widthTween = ex.tweens.find(
      (t) => (t as any).property === "width",
    ) as Record<string, unknown>;
    expect(widthTween?.from).toBe(0);
    expect(widthTween?.to).toBe(360);
    expect(widthTween?.target).toBe("lt__bar");
    expect(widthTween?.id).toBe("lt__t2");
  });

  it("uses default offsets when only required params are supplied", () => {
    const ex = expandTemplate(
      "lt",
      {
        template: "lowerThird",
        params: {
          name: "N",
          role: "R",
          fontDisplay: "fd",
          fontMono: "fm",
        },
      },
    );
    expect((ex.items["lt__name"] as any).transform.y).toBe(900);
    expect((ex.items["lt__role"] as any).transform.y).toBe(938);
    expect((ex.items["lt__bar"] as any).transform.y).toBe(980);
  });
});

describe("captionBurst", () => {
  it("popIn carries through the fromScale param", () => {
    const ex = expandTemplate(
      "cap",
      {
        template: "captionBurst",
        params: {
          text: "Boom",
          font: "fd",
          fromScale: 0.05,
        },
      },
    );
    expect((ex.items["cap__caption"] as any).text).toBe("Boom");
    const popIn = ex.tweens[0] as Record<string, unknown>;
    expect(popIn.$behavior).toBe("popIn");
    expect((popIn.params as Record<string, unknown>).fromScale).toBe(0.05);
    expect((popIn.params as Record<string, unknown>).toScale).toBe(1);
  });

  it("forwards a numeric duration through the placeholder", () => {
    const ex = expandTemplate(
      "cap",
      {
        template: "captionBurst",
        params: {
          text: "Boom",
          font: "fd",
          duration: 0.8,
        },
      },
    );
    const popIn = ex.tweens[0] as Record<string, unknown>;
    expect(popIn.duration).toBe(0.8);
  });
});

describe("bulletList", () => {
  it("emits three bullets with staggered fadeIn starts", () => {
    const ex = expandTemplate(
      "bl",
      {
        template: "bulletList",
        params: {
          bullet1: "First",
          bullet2: "Second",
          bullet3: "Third",
          font: "fd",
        },
      },
    );
    expect(Object.keys(ex.items).sort()).toEqual([
      "bl__b1",
      "bl__b2",
      "bl__b3",
    ]);
    expect((ex.items["bl__b1"] as any).text).toBe("First");
    expect((ex.items["bl__b2"] as any).text).toBe("Second");
    expect((ex.items["bl__b3"] as any).text).toBe("Third");

    const starts = ex.tweens.map((t) => (t as any).start as number);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(0.15, 10);
    expect(starts[2]).toBeCloseTo(0.3, 10);
    for (const t of ex.tweens) {
      expect((t as any).$behavior).toBe("fadeIn");
    }
  });

  it("respects a custom stagger via params", () => {
    const ex = expandTemplate(
      "bl",
      {
        template: "bulletList",
        params: {
          bullet1: "a",
          bullet2: "b",
          bullet3: "c",
          font: "fd",
          stagger: 0.25,
          stagger2: 0.5,
        },
      },
    );
    const starts = ex.tweens.map((t) => (t as any).start as number);
    expect(starts).toEqual([0, 0.25, 0.5]);
  });
});

describe("kenburnsImage", () => {
  it("emits a sprite with the asset id and a kenburns + fadeIn pair", () => {
    const ex = expandTemplate(
      "bg",
      {
        template: "kenburnsImage",
        params: {
          asset: "hero-img",
          width: 1920,
          height: 1080,
          toScale: 1.4,
          pan: 200,
        },
      },
    );
    const sprite = ex.items["bg__img"] as Record<string, unknown>;
    expect(sprite.type).toBe("sprite");
    expect(sprite.asset).toBe("hero-img");
    expect(sprite.width).toBe(1920);
    expect(sprite.height).toBe(1080);

    const kb = ex.tweens.find(
      (t) => (t as any).$behavior === "kenburns",
    ) as Record<string, unknown>;
    expect(kb?.target).toBe("bg__img");
    expect((kb.params as Record<string, unknown>).toScale).toBe(1.4);
    expect((kb.params as Record<string, unknown>).pan).toBe(200);
    expect((kb.params as Record<string, unknown>).axis).toBe("x");

    const fade = ex.tweens.find(
      (t) => (t as any).$behavior === "fadeIn",
    ) as Record<string, unknown>;
    expect(fade?.target).toBe("bg__img");
  });

  it("compiles end-to-end (kenburns expands to scaleX/scaleY + axis tween)", async () => {
    const comp = {
      version: "0.3",
      composition: { width: 1280, height: 720, fps: 30, duration: 8, background: "#000" },
      assets: [{ id: "hero", type: "image", src: "./hero.png" }],
      layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["bg"] }],
      items: {
        bg: {
          $template: "kenburnsImage",
          params: {
            asset: "hero",
            width: 1280,
            height: 720,
            duration: 5,
          },
        },
      },
      tweens: [],
    };
    const out = (await precompile(comp)) as {
      tweens: Array<Record<string, unknown>>;
    };
    const props = out.tweens.map((t) => t.property as string).sort();
    // fadeIn → opacity. kenburns → scaleX + transform.x (scaleY held by the
    // sprite's initial transform — that's how the kenburns behavior is wired).
    expect(props).toEqual([
      "transform.opacity",
      "transform.scaleX",
      "transform.x",
    ]);
  });
});
