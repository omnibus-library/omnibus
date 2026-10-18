import { BaseComponent } from "./BaseComponent";

/** The window's scroll offset, which the app records per path and restores on back-navigation. */
export class PageScrollComponent extends BaseComponent {
  y(): Promise<number> {
    return this.page.evaluate(() => window.scrollY);
  }

  /** The offset once it has held for a quarter second; a restore nudges it as pages stream in. */
  settledY(): Promise<number> {
    return this.page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const deadline = Date.now() + 5_000;
          let previous = Number.NaN;
          const check = () => {
            const y = window.scrollY;
            if (y === previous) return resolve(y);
            if (Date.now() > deadline) {
              return reject(new Error("the scroll offset never settled"));
            }
            previous = y;
            setTimeout(check, 250);
          };
          check();
        }),
    );
  }

  async toBottom(): Promise<void> {
    await this.page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
  }

  /** A real wheel gesture, which also cancels a restore still converging. */
  async wheelUp(pixels: number): Promise<void> {
    await this.page.mouse.move(500, 200);
    await this.page.mouse.wheel(0, -pixels);
  }
}
