import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Home from "@/pages/home/Home";
import { LegalDrawerProvider } from "@/lib/legalDrawer";

const mission = [
  "Capavate draws on our decades of early-stage investing experience across the globe. Platforms are, and should be, simple tools. Your network, and your ability to build trusted relationships within it as your business and investments grow, is your real asset.",
  "Too often, founders, investors, and ecosystem partners work through disconnected tools. Our experience has taught us that this fragmentation gets in the way. These participants have distinct needs but interconnected responsibilities that cannot be managed effectively in isolation. Our mission is to bring them together in Capavate, working from consistent information, clear responsibilities, and controlled access. Every round should build on the relationships and records of the last, not start over.",
  "Capavate is the shared infrastructure for founders raising capital, investors backing businesses, and Consortium Partners bringing them together. Founders manage their rounds, ownership, and investor relationships. Investors can connect directly with fellow investors on the register, share insights, and offer constructive advice to founders, while maintaining a clear record of their investments. Consortium Partners qualify their pipelines, manage clients’ raises, and launch their own SPVs. This is how companies scale, networks grow stronger, and ecosystems thrive.",
];

function mount(strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/" });
  const tree = <QueryClientProvider client={client}><LegalDrawerProvider><Router hook={hook}><Home /></Router></LegalDrawerProvider></QueryClientProvider>;
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("UI-only test: no server"))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Owner-directed marketing landing UI", () => {
  it("keeps the exact hero heading/tagline and all three existing CTA destinations", () => {
    const { container } = mount();
    const hero = container.querySelector(".hero")!;
    expect(hero.querySelector(".eyebrow")?.textContent?.trim()).toBe("The Equity Social Network");
    expect(hero.querySelector("h1")?.textContent).toBe("Your investors are more connected than you think.");
    expect(Array.from(hero.querySelectorAll("a")).map(a => a.getAttribute("href"))).toEqual([
      "/onboarding", "#ecosystem", "https://capavate.com/onboarding",
    ]);
    expect(hero.querySelector('[data-testid="home-hero-partner-value"]')?.textContent?.replace(/\s+/g, " ").trim())
      .toBe("Consortium Partners can qualify their sales pipelines, manage clients’ funding rounds, and launch their own SPVs on Capavate.");
    expect(hero.querySelector(".hero__ctas")?.previousElementSibling?.hasAttribute("data-home-partner-value-host")).toBe(true);
  });

  it("renders the owner's three mission paragraphs verbatim, not a summary or hidden disclosure", () => {
    const { container } = mount();
    const paragraphs = container.querySelectorAll('[data-testid="home-mission-copy"] > p');
    expect(Array.from(paragraphs).map(p => p.textContent)).toEqual(mission);
    expect(container.querySelector("#mission")?.closest("[hidden]")).toBeNull();
    expect(container.querySelector("#mission details")).toBeNull();
  });

  it("keeps all sections once, with Mission second and Trust immediately before Pricing", () => {
    const { container } = mount();
    const sections = Array.from(container.querySelector("main")!.children);
    expect(sections.map(s => s.id || s.getAttribute("data-testid") || (s.classList.contains("hero") ? "hero" : "")))
      .toEqual(["hero", "mission", "audiences", "multiplier", "dynamic-crm", "platform", "how-it-works",
        "credibility-section", "trust-signals-section", "pricing", "learn", "cta-final"]);
  });

  it("uses the supplied portrait and exact safe LinkedIn destination without an invented job title", () => {
    const { container } = mount();
    const figure = container.querySelector("#mission figure")!;
    const image = figure.querySelector("img")!;
    expect(image.getAttribute("src")).toContain("ozan-isinak.webp");
    expect(image.getAttribute("alt")).toBe("Ozan Isinak speaking at an event");
    expect([image.getAttribute("width"), image.getAttribute("height")]).toEqual(["790", "956"]);
    expect(figure.querySelector("figcaption")?.textContent).toContain("Ozan Isinak");
    expect(figure.textContent).not.toMatch(/CEO|President|Founder/);
    const link = figure.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://www.linkedin.com/in/ozanisinak/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("creates one host under StrictMode, removes only its own host, and remounts cleanly", () => {
    const unrelated = document.createElement("div");
    unrelated.className = "hero";
    unrelated.innerHTML = '<div class="hero__content"><div class="hero__ctas">Outside Home</div></div>';
    document.body.appendChild(unrelated);
    const first = mount(true);
    expect(first.container.querySelectorAll("[data-home-partner-value-host]")).toHaveLength(1);
    expect(first.container.querySelectorAll('[data-testid="home-hero-partner-value"]')).toHaveLength(1);
    expect(unrelated.querySelector("[data-home-partner-value-host]")).toBeNull();
    first.unmount();
    expect(first.container.querySelector("[data-home-partner-value-host]")).toBeNull();
    expect(unrelated.textContent).toBe("Outside Home");
    const second = mount(true);
    expect(second.container.querySelectorAll("[data-home-partner-value-host]")).toHaveLength(1);
    unrelated.remove();
  });
});
